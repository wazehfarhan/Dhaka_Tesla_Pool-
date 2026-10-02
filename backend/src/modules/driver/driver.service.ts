import type { Database } from '../../db/client.js';
import { PoolStatus } from '../../generated/prisma/client.js';
import type { RideStatus } from '../../generated/prisma/client.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  RideAlreadyStartedError,
} from '../../shared/errors.js';
import { createFareService } from '../fare/fare.service.js';
import { createDriverRepository, type PoolRideRow } from './driver.repository.js';
import type { ListPoolsQuery } from './driver.schemas.js';
import {
  CANCELLABLE_POOL_STATUSES,
  CANCEL_REASONS,
  DRIVER_TRANSITIONS,
  decideCancel,
  toCancelRefusal,
  type CancelDecision,
  type DriverAction,
} from './driver.transitions.js';
import type {
  DriverPoolDetail,
  DriverPoolListItem,
  PoolCancelResponse,
  PoolMemberView,
  TransitionResponse,
} from './driver.types.js';

/**
 * Driver flow — api.md §6, PRD §8 (trip progression) and FR-HISTORY-002.
 *
 * Every transition is **one transaction** (todo Phase 5): conditional pool
 * flip → cascade the same status onto every active ride → append history for
 * the pool *and* each ride → on `complete`, finalize every fare (discount iff
 * ≥ 2 active completers) and create the `PENDING` payments (api.md §6.4,
 * PRD §13). A throw anywhere rolls the whole step back, so a half-advanced
 * pool is impossible.
 *
 * Reads are ownership-scoped: a pool that exists but belongs to another
 * driver is a plain `404`, never a `403` (api.md §1 — no ID probing).
 */

/** The membership test for a `?status=` filter — same leniency as `GET /rides`. */
const POOL_STATUSES = new Set<string>(Object.values(PoolStatus));

/**
 * Zone ids → names, resolved once per request — a missing reference row is an
 * integrity bug that answers 500, names are never invented (api.md §1).
 * Mirrors the helper in rides.service (same rule, different module).
 */
function zoneNameResolver(zones: ReadonlyArray<{ id: number; name: string }>) {
  const names = new Map(zones.map((zone) => [zone.id, zone.name]));
  return (zoneId: number): string => {
    const name = names.get(zoneId);
    if (name === undefined) {
      throw new AppError('INTERNAL', `Zone ${zoneId} is missing from the reference data.`);
    }
    return name;
  };
}

/**
 * The refusal for a refused cancellation: `STARTED` gets its own code so the UI
 * can say "the trip has already started" (PRD §14), anything already terminal
 * gets the generic state-machine 409 (api.md §5.4). `current` rides along as
 * the `details` field, mirroring the progression endpoints' `{current, expected}`.
 */
function cancelError(decision: Exclude<CancelDecision, { ok: true }>): AppError {
  if (decision.code === 'RIDE_ALREADY_STARTED') {
    return new RideAlreadyStartedError();
  }
  return new ConflictError(
    'ILLEGAL_STATE_TRANSITION',
    `A ${decision.current} ride can no longer be cancelled.`,
    {
      current: decision.current,
    },
  );
}

/** One roster row, shared by the detail and every transition response (api.md §6.2/6.4). */
function toMemberView(row: PoolRideRow): PoolMemberView {
  return {
    rideId: row.id,
    passenger: row.passenger.name,
    seats: row.seats,
    status: row.status,
    fare:
      row.fare === null
        ? null
        : {
            status: row.fare.status,
            subtotalPoisha: row.fare.subtotalPoisha,
            poolDiscountPoisha: row.fare.poolDiscountPoisha,
            totalPoisha: row.fare.totalPoisha,
          },
    payment:
      row.payment === null
        ? null
        : { status: row.payment.status, amountPoisha: row.payment.amountPoisha },
  };
}

export interface ListPoolsResult {
  data: DriverPoolListItem[];
  meta: { page: number; limit: number; total: number };
}

export interface DriverService {
  listPools(driverId: string, query: ListPoolsQuery): Promise<ListPoolsResult>;
  getPoolDetail(driverId: string, poolId: string): Promise<DriverPoolDetail>;
  transition(driverId: string, poolId: string, action: DriverAction): Promise<TransitionResponse>;
  /** `POST /driver/pools/:id/cancel` — the driver's own pre-start abandon (api.md §6.5). */
  cancelPool(driverId: string, poolId: string): Promise<PoolCancelResponse>;
}

export function createDriverService({ database }: { database?: Database }): DriverService {
  /** Honest failure: no database → 500, never a fabricated answer (mirrors rides.service). */
  function db(): Database {
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database;
  }

  const root = () => db().prisma;

  return {
    async listPools(driverId, { page, limit, status }): Promise<ListPoolsResult> {
      const pools = createDriverRepository(root());
      const meta = { page, limit, total: 0 };

      // Lenient by design (driver.schemas): an unknown status is a filter that
      // matches nothing — the same envelope, an empty page, never a 400.
      let statusFilter: PoolStatus | undefined;
      if (status !== undefined) {
        if (!POOL_STATUSES.has(status)) return { data: [], meta };
        statusFilter = status as PoolStatus;
      }

      const { rows, total } = await pools.listOwnedPools(
        driverId,
        statusFilter,
        (page - 1) * limit,
        limit,
      );
      meta.total = total;

      const [zones, rides] = await Promise.all([
        pools.listZones(),
        pools.listRidesForPools(rows.map((pool) => pool.id)),
      ]);
      const name = zoneNameResolver(zones);
      const ridesByPool = new Map<string, PoolRideRow[]>();
      for (const ride of rides) {
        const bucket = ridesByPool.get(ride.poolId);
        if (bucket) bucket.push(ride);
        else ridesByPool.set(ride.poolId, [ride]);
      }

      // Corridors repeat across rows — resolve each unordered pair at most once.
      const distanceCache = new Map<string, number | null>();
      const distanceOf = async (
        pickupZoneId: number,
        destinationZoneId: number,
      ): Promise<number | null> => {
        const [zoneA, zoneB] = [
          Math.min(pickupZoneId, destinationZoneId),
          Math.max(pickupZoneId, destinationZoneId),
        ];
        const key = `${zoneA}:${zoneB}`;
        const cached = distanceCache.get(key);
        if (cached !== undefined) return cached;
        const route = await pools.findDistance(zoneA, zoneB);
        const distanceKm = route?.distanceKm ?? null;
        distanceCache.set(key, distanceKm);
        return distanceKm;
      };

      const data: DriverPoolListItem[] = [];
      for (const pool of rows) {
        data.push({
          id: pool.id,
          status: pool.status,
          pickupZone: name(pool.pickupZoneId),
          destinationZone: name(pool.destinationZoneId),
          distanceKm: await distanceOf(pool.pickupZoneId, pool.destinationZoneId),
          seatsTaken: pool.seatsTaken,
          seatCapacity: pool.seatCapacity,
          members: (ridesByPool.get(pool.id) ?? []).map((ride) => ({
            passenger: ride.passenger.name,
            seats: ride.seats,
            status: ride.status,
          })),
          createdAt: pool.createdAt.toISOString(),
        });
      }
      return { data, meta };
    },

    async getPoolDetail(driverId, poolId): Promise<DriverPoolDetail> {
      const pools = createDriverRepository(root());

      // Ownership scope: foreign or unknown id → 404 (api.md §1 + §6).
      const pool = await pools.findOwnedPool(driverId, poolId);
      if (!pool) throw new NotFoundError('Pool not found.');

      const [rides, timeline, zones] = await Promise.all([
        pools.listPoolRides(poolId),
        pools.listPoolHistory(poolId),
        pools.listZones(),
      ]);
      const name = zoneNameResolver(zones);
      const route = await pools.findDistance(pool.pickupZoneId, pool.destinationZoneId);

      return {
        id: pool.id,
        status: pool.status,
        pickupZone: name(pool.pickupZoneId),
        destinationZone: name(pool.destinationZoneId),
        distanceKm: route?.distanceKm ?? null,
        seatsTaken: pool.seatsTaken,
        seatCapacity: pool.seatCapacity,
        members: rides.map(toMemberView),
        timeline: timeline.map((entry) => ({
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          reason: entry.reason,
          createdAt: entry.createdAt.toISOString(),
        })),
        createdAt: pool.createdAt.toISOString(),
      };
    },

    async transition(driverId, poolId, action): Promise<TransitionResponse> {
      const rule = DRIVER_TRANSITIONS[action];

      return db().prisma.$transaction(async (tx) => {
        const pools = createDriverRepository(tx);

        // Ownership first — a foreign pool is a 404 before any state talk (api.md §6).
        const pool = await pools.findOwnedPool(driverId, poolId);
        if (!pool) throw new NotFoundError('Pool not found.');

        // The atomic gate: the flip only lands while the pool is still in the
        // expected status, so a racing twin transition loses and gets the 409.
        const claimed = await pools.claimPoolTransition(poolId, rule.from, rule.to);
        if (claimed === 0) {
          const fresh = await pools.findPool(poolId);
          if (!fresh) throw new NotFoundError('Pool not found.');
          // api.md §6.3: 409 ILLEGAL_STATE_TRANSITION with {current, expected}.
          throw new ConflictError(
            'ILLEGAL_STATE_TRANSITION',
            `The pool is ${fresh.status}; "${action}" requires ${rule.from}.`,
            { current: fresh.status, expected: rule.from },
          );
        }

        // Cascade: every non-cancelled ride mirrors the pool status (PRD §9).
        const activeRides = await pools.listActivePoolRides(poolId);
        for (const ride of activeRides) {
          await pools.updateRideStatus(ride.id, rule.to as RideStatus);
          await pools.createHistory({
            entityType: 'RIDE_REQUEST',
            entityId: ride.id,
            fromStatus: ride.status,
            toStatus: rule.to,
            changedBy: driverId,
            reason: rule.reason,
          });
        }
        await pools.createHistory({
          entityType: 'POOL',
          entityId: poolId,
          fromStatus: rule.from,
          toStatus: rule.to,
          changedBy: driverId,
          reason: rule.reason,
        });

        if (action === 'complete') {
          // FR-FARE-002 + PRD §13 — same transaction: finalize each active
          // member's fare (discount iff ≥ 2 completers), then create its
          // PENDING payment. Closes the Phase 7 fare-lifecycle box (todo.md).
          const fares = createFareService({ database });
          const completers = activeRides.length;
          for (const ride of activeRides) {
            const fare = await fares.finalizeRideFare(ride.id, completers, tx);
            await tx.payment.create({
              data: { rideRequestId: ride.id, amountPoisha: fare.totalDuePoisha },
            });
          }
        }

        // The documented response (api.md §6.3–6.4) — re-reading inside the
        // transaction sees its own writes: FINAL fares + PENDING payments
        // after complete, ESTIMATED fares + null payments before.
        const rides = await pools.listPoolRides(poolId);
        return {
          id: poolId,
          status: rule.to,
          members: rides.map(toMemberView),
        };
      });
    },

    /**
     * `POST /driver/pools/:id/cancel` (api.md §6.5, PRD §14) — the driver's
     * no-show / breakdown path, refused once the trip is `STARTED`.
     *
     * One transaction, same discipline as `transition`: ownership → conditional
     * pool flip → cascade `CANCELLED` onto every *active* ride (a member who
     * already cancelled keeps their own terminal row) → release the seats →
     * history for the pool and each ride with reason `DRIVER_CANCELLED`. Fares
     * stay `ESTIMATED` and no payment is created: a cancelled trip is never
     * charged (PRD §14 — no cancellation fee, A-07).
     */
    async cancelPool(driverId, poolId): Promise<PoolCancelResponse> {
      return db().prisma.$transaction(async (tx) => {
        const pools = createDriverRepository(tx);

        const pool = await pools.findOwnedPool(driverId, poolId);
        if (!pool) throw new NotFoundError('Pool not found.');

        const current = pool.status;
        const decision = decideCancel('pool', current);
        // `=== false`, not `!decision.ok`: truthiness does not narrow the `ok`
        // discriminant unless `strictNullChecks` is on, so the shorthand leaves
        // the whole union (including `ok: true`) flowing into the refusal helper.
        if (decision.ok === false) throw cancelError(decision);

        // Atomic gate: 0 rows means the pool started or was cancelled under us.
        const claimed = await pools.claimPoolCancellation(poolId, CANCELLABLE_POOL_STATUSES);
        if (claimed === 0) {
          const fresh = await pools.findPool(poolId);
          const latest = fresh?.status ?? current;
          throw cancelError(toCancelRefusal(decideCancel('pool', latest), latest));
        }

        const activeRides = await pools.listActivePoolRides(poolId);
        for (const ride of activeRides) {
          await pools.updateRideStatus(ride.id, 'CANCELLED');
          const member = await pools.findMemberByRide(ride.id);
          if (member) await pools.cancelMember(member.id);
          await pools.createHistory({
            entityType: 'RIDE_REQUEST',
            entityId: ride.id,
            fromStatus: ride.status,
            toStatus: 'CANCELLED',
            changedBy: driverId,
            reason: CANCEL_REASONS.driver,
          });
        }
        await pools.createHistory({
          entityType: 'POOL',
          entityId: poolId,
          fromStatus: current,
          toStatus: 'CANCELLED',
          changedBy: driverId,
          reason: CANCEL_REASONS.driver,
        });

        // Seats go back to the car in the same transaction (PRD §14).
        for (const ride of activeRides) {
          await pools.releaseSeats(poolId, ride.seats);
        }

        const rides = await pools.listPoolRides(poolId);
        return { id: poolId, status: 'CANCELLED', members: rides.map(toMemberView) };
      });
    },
  };
}
