import type { Database } from '../../db/client.js';
import { RideStatus } from '../../generated/prisma/client.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  RideAlreadyStartedError,
  SameZoneError,
  ZoneNotFoundError,
} from '../../shared/errors.js';
import {
  CANCELLABLE_RIDE_STATUSES,
  CANCEL_REASONS,
  decideCancel,
  toCancelRefusal,
  type CancelDecision,
} from '../driver/driver.transitions.js';
import { createFareService, estimateFare } from '../fare/fare.service.js';
import type { FareBreakdown } from '../fare/fare.types.js';
import { createMatchedRide, type PersistHook } from '../matching/matching.service.js';
import { createRidesRepository, type RidesPersistenceClient } from './rides.repository.js';
import type { CreateRideInput, ListRidesQuery } from './rides.schemas.js';
import type {
  CreateRideResponse,
  PaymentView,
  RideCancelResponse,
  RideDetail,
  RideListItem,
} from './rides.types.js';

/**
 * Passenger flow — api.md §5, requirements FR-POOL-001…003 and FR-HISTORY-001.
 *
 * `createRide` is the one place the documented server-side sequence lives
 * (api.md §5.1 / architecture.md §6): validate → resolve zones → detect a
 * replayed idempotency key → match (join or create) → atomic seat claim →
 * persist ride + membership + `ESTIMATED` fare + status history, **all in one
 * transaction** — the persist hook joins `createMatchedRide`'s transaction, so a
 * failure anywhere rolls the whole claim back.
 *
 * Reads are ownership-scoped: a ride that exists but belongs to someone else is
 * a `404`, never a `403` (api.md §1 — no ID probing).
 */

/** The statuses a ride can hold — the membership test for a `?status=` filter. */
const RIDE_STATUSES = new Set<string>(Object.values(RideStatus));

function isRideStatus(value: string): value is RideStatus {
  return RIDE_STATUSES.has(value);
}

/** `total ÷ seats`, exact and integer-only: the stored total *is* perSeat × seats (FR-FARE-002). */
function perSeatFromTotal(totalPoisha: number, seats: number): number {
  return (totalPoisha - (totalPoisha % seats)) / seats;
}

/**
 * The refusal for a refused cancellation, shared with the driver pool-cancel
 * path (PRD §14): `STARTED` gets its own code so the UI can say "the trip has
 * already started", anything already terminal gets the generic 409
 * (api.md §5.4). `current` rides along as `details`, mirroring the progression
 * endpoints' `{current, expected}`.
 */
function cancelRefusal(decision: Exclude<CancelDecision, { ok: true }>): AppError {
  if (decision.code === 'RIDE_ALREADY_STARTED') return new RideAlreadyStartedError();
  return new ConflictError(
    'ILLEGAL_STATE_TRANSITION',
    `A ${decision.current} ride can no longer be cancelled.`,
    { current: decision.current },
  );
}

/** A payment row in the documented wire shape (api.md §8 — amounts are poisha). */
function toPaymentView(payment: {
  id: string;
  rideRequestId: string;
  amountPoisha: number;
  status: string;
  method: string;
  paidAt: Date | null;
}): PaymentView {
  return {
    id: payment.id,
    rideId: payment.rideRequestId,
    amountPoisha: payment.amountPoisha,
    currency: 'BDT',
    status: payment.status,
    method: payment.method,
    paidAt: payment.paidAt === null ? null : payment.paidAt.toISOString(),
  };
}

/** `201` on a fresh ride, `200` when the request was an idempotent replay (api.md §5.1). */
export interface CreateRideResult {
  status: 200 | 201;
  ride: CreateRideResponse;
}

export interface ListRidesResult {
  data: RideListItem[];
  meta: { page: number; limit: number; total: number };
}

export interface RidesService {
  createRide(passengerId: string, input: CreateRideInput): Promise<CreateRideResult>;
  listRides(passengerId: string, query: ListRidesQuery): Promise<ListRidesResult>;
  getRideDetail(passengerId: string, rideId: string): Promise<RideDetail>;
  /** `POST /rides/:id/cancel` — the passenger's own pre-start exit (api.md §5.4). */
  cancelRide(passengerId: string, rideId: string, reason?: string): Promise<RideCancelResponse>;
  /** `GET /rides/:id/payment` — 404 until the trip completes (api.md §8). */
  getPayment(passengerId: string, rideId: string): Promise<PaymentView>;
  /** `POST /rides/:id/payment/simulate` — idempotent `PENDING → PAID` (api.md §8). */
  simulatePayment(passengerId: string, rideId: string): Promise<PaymentView>;
}

/**
 * Zone ids → names. Zones are small reference data (8 seeded rows, database.md
 * §3.1) read once per request; a name is never invented, so a missing row is an
 * integrity bug that answers 500 (api.md §1).
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

export function createRidesService({ database }: { database?: Database }): RidesService {
  /** Honest failure: no database → 500, never a fabricated ride (mirrors fare.service). */
  function db(): Database {
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database;
  }

  const root = (): RidesPersistenceClient => db().prisma;
  const fares = createFareService({ database });

  return {
    async createRide(passengerId, input): Promise<CreateRideResult> {
      const rides = createRidesRepository(root());

      // Cheap literal check first (exactly how POST /fare/estimate does it):
      // "Banani" → "banani" is the same zone and must never reach matching.
      if (input.pickupZone.toLowerCase() === input.destinationZone.toLowerCase()) {
        throw new SameZoneError();
      }

      const pickup = await rides.findZoneByName(input.pickupZone);
      const destination = await rides.findZoneByName(input.destinationZone);
      if (!pickup || !destination) throw new ZoneNotFoundError();
      if (pickup.id === destination.id) throw new SameZoneError();

      const route = await rides.findDistance(pickup.id, destination.id);
      if (!route) throw new ZoneNotFoundError('No recorded distance between the selected zones.');

      // Replay detection comes *before* matching: a retried key must return the
      // original ride even though the caller now holds an active ride
      // (UNIQUE (passenger_id, client_request_id); api.md §5.1).
      if (input.clientRequestId !== undefined) {
        const replayed = await rides.findRideByClientRequestId(passengerId, input.clientRequestId);
        if (replayed) {
          const stored = await rides.findFare(replayed.id);
          // The fare row is written in the creation transaction, so the fallback
          // below only ever serves hand-seeded fixtures.
          const estimate =
            stored === null
              ? estimateFare(route.distanceKm, replayed.seats)
              : {
                  distanceKm: stored.distanceKm,
                  perSeatPoisha: perSeatFromTotal(stored.totalPoisha, replayed.seats),
                  totalDuePoisha: stored.totalPoisha,
                  currency: stored.currency,
                };
          return {
            status: 200,
            ride: {
              id: replayed.id,
              status: replayed.status,
              poolId: replayed.poolId,
              seats: replayed.seats,
              pickupZone: pickup.name,
              destinationZone: destination.name,
              distanceKm: estimate.distanceKm,
              estimate: {
                perSeatPoisha: estimate.perSeatPoisha,
                totalDuePoisha: estimate.totalDuePoisha,
                currency: estimate.currency,
              },
              createdAt: replayed.createdAt.toISOString(),
            },
          };
        }
      }

      // architecture §6 step 7 — the fare estimate and the creation history join
      // the matching transaction, so claim + ride + member + fare + trail commit
      // (or roll back) together.
      let estimate: FareBreakdown | undefined;
      const persist: PersistHook = async (tx, outcome) => {
        estimate = await fares.saveEstimate(
          outcome.rideRequestId,
          route.distanceKm,
          input.seats,
          tx,
        );

        const trail = createRidesRepository(tx);
        await trail.createHistory({
          entityType: 'RIDE_REQUEST',
          entityId: outcome.rideRequestId,
          fromStatus: null,
          toStatus: RideStatus.REQUESTED,
          changedBy: passengerId,
          reason: 'RIDE_REQUESTED',
        });
        if (!outcome.joinedExistingPool) {
          await trail.createHistory({
            entityType: 'POOL',
            entityId: outcome.poolId,
            fromStatus: null,
            toStatus: 'OPEN',
            changedBy: passengerId,
            reason: 'POOL_CREATED',
          });
        }
      };

      const outcome = await createMatchedRide(
        db(),
        {
          passengerId,
          pickupZoneId: pickup.id,
          destinationZoneId: destination.id,
          seats: input.seats,
          ...(input.clientRequestId === undefined
            ? {}
            : { clientRequestId: input.clientRequestId }),
        },
        persist,
      );

      // Unreachable: the hook above is awaited inside the transaction before it
      // commits. Missing here would mean a persisted ride without its fare.
      if (estimate === undefined) {
        throw new AppError('INTERNAL', 'The fare estimate was not persisted with the ride.');
      }

      return {
        status: 201,
        ride: {
          id: outcome.rideRequestId,
          status: RideStatus.REQUESTED, // the column default — a fresh ride is never anything else
          poolId: outcome.poolId,
          seats: input.seats,
          pickupZone: pickup.name,
          destinationZone: destination.name,
          distanceKm: estimate.distanceKm,
          estimate: {
            perSeatPoisha: estimate.perSeatPoisha,
            totalDuePoisha: estimate.totalDuePoisha,
            currency: estimate.currency,
          },
          createdAt: outcome.createdAt.toISOString(),
        },
      };
    },

    async listRides(passengerId, { page, limit, status }): Promise<ListRidesResult> {
      const rides = createRidesRepository(root());
      const meta = { page, limit, total: 0 };

      // Lenient by design (see rides.schemas): an unknown status is not a 400,
      // it is a filter that matches nothing — the same envelope, an empty page.
      let statusFilter: RideStatus | undefined;
      if (status !== undefined) {
        if (!isRideStatus(status)) return { data: [], meta };
        statusFilter = status;
      }

      const { rows, total } = await rides.listOwnedRides(
        passengerId,
        statusFilter,
        (page - 1) * limit,
        limit,
      );
      const name = zoneNameResolver(await rides.listZones());

      return {
        data: rows.map((row) => ({
          id: row.id,
          status: row.status,
          poolId: row.poolId,
          seats: row.seats,
          pickupZone: name(row.pickupZoneId),
          destinationZone: name(row.destinationZoneId),
          distanceKm: row.fare?.distanceKm ?? null,
          fare:
            row.fare === null
              ? null
              : {
                  status: row.fare.status,
                  totalPoisha: row.fare.totalPoisha,
                  currency: row.fare.currency,
                },
          payment:
            row.payment === null
              ? null
              : { status: row.payment.status, amountPoisha: row.payment.amountPoisha },
          createdAt: row.createdAt.toISOString(),
        })),
        meta: { page, limit, total },
      };
    },

    async getRideDetail(passengerId, rideId): Promise<RideDetail> {
      const rides = createRidesRepository(root());

      // Ownership scope: a ride that exists but isn't the caller's is a 404 (api.md §1).
      const ride = await rides.findOwnedRide(passengerId, rideId);
      if (!ride) throw new NotFoundError('Ride not found.');

      const [pool, memberCount, timeline, fare, payment, zones] = await Promise.all([
        rides.findPool(ride.poolId),
        rides.countActivePoolMembers(ride.poolId),
        rides.listHistory('RIDE_REQUEST', ride.id),
        rides.findFare(ride.id),
        rides.findPayment(ride.id),
        rides.listZones(),
      ]);
      // `pool_id` is NOT NULL and FK-enforced: a missing pool is an integrity bug.
      if (!pool) throw new AppError('INTERNAL', 'The ride references a missing pool.');

      const name = zoneNameResolver(zones);

      return {
        id: ride.id,
        status: ride.status,
        poolId: ride.poolId,
        seats: ride.seats,
        pickupZone: name(ride.pickupZoneId),
        destinationZone: name(ride.destinationZoneId),
        distanceKm: fare?.distanceKm ?? null,
        pool: {
          id: pool.id,
          status: pool.status,
          seatsTaken: pool.seatsTaken,
          seatCapacity: pool.seatCapacity,
          memberCount,
        },
        timeline: timeline.map((entry) => ({
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          reason: entry.reason,
          createdAt: entry.createdAt.toISOString(),
        })),
        fare:
          fare === null
            ? null
            : {
                status: fare.status,
                baseFarePoisha: fare.baseFarePoisha,
                distanceChargePoisha: fare.distanceChargePoisha,
                subtotalPoisha: fare.subtotalPoisha,
                poolDiscountPoisha: fare.poolDiscountPoisha,
                totalPoisha: fare.totalPoisha,
                currency: fare.currency,
              },
        payment:
          payment === null ? null : { status: payment.status, amountPoisha: payment.amountPoisha },
        createdAt: ride.createdAt.toISOString(),
      };
    },

    /**
     * `POST /rides/:id/cancel` (api.md §5.4, PRD §14) — the passenger's own
     * pre-start exit.
     *
     * One transaction: ownership → conditional ride flip → membership
     * `CANCELLED` → seats released → history with reason `PASSENGER_CANCELLED`.
     * If that leaves the pool with **zero** active members the pool is
     * abandoned too (`POOL_EMPTY`) — nobody is left to serve. Other members are
     * never touched (PRD §14: "other members' rides, seats and fares are never
     * affected"), and the cancelled ride's fare stays `ESTIMATED` with no
     * payment: a cancelled trip is never charged (A-07, no cancellation fee).
     */
    async cancelRide(passengerId, rideId, reason): Promise<RideCancelResponse> {
      return db().prisma.$transaction(async (tx) => {
        const rides = createRidesRepository(tx);

        // Ownership scope: a foreign or unknown ride is a 404 (api.md §1).
        const ride = await rides.findOwnedRide(passengerId, rideId);
        if (!ride) throw new NotFoundError('Ride not found.');

        const current = ride.status;
        const decision = decideCancel('ride', current);
        // `=== false`, not `!decision.ok`: truthiness does not narrow the `ok`
        // discriminant unless `strictNullChecks` is on, so the shorthand leaves
        // the whole union (including `ok: true`) flowing into the refusal helper.
        if (decision.ok === false) throw cancelRefusal(decision);

        // Atomic gate: 0 rows means the driver started it (or someone else
        // cancelled it) between the read above and here.
        const claimed = await rides.claimRideCancellation(rideId, CANCELLABLE_RIDE_STATUSES);
        if (claimed === 0) {
          const fresh = await rides.findOwnedRide(passengerId, rideId);
          const latest = fresh?.status ?? current;
          throw cancelRefusal(toCancelRefusal(decideCancel('ride', latest), latest));
        }

        const member = await rides.findMemberByRide(rideId);
        if (member) {
          await rides.cancelMember(member.id);
          await rides.releaseSeats(ride.poolId, member.seats);
        }
        await rides.createHistory({
          entityType: 'RIDE_REQUEST',
          entityId: rideId,
          fromStatus: current,
          toStatus: 'CANCELLED',
          changedBy: passengerId,
          reason: CANCEL_REASONS.passenger,
        });

        // Last one out cancels the pool (PRD §14, reason `POOL_EMPTY`).
        const pool = await rides.findPool(ride.poolId);
        if (!pool) throw new AppError('INTERNAL', 'The ride references a missing pool.');
        const remaining = await rides.countActivePoolMembers(ride.poolId);
        let poolStatus = pool.status;
        if (remaining === 0 && pool.status !== 'CANCELLED') {
          await rides.cancelPool(ride.poolId);
          await rides.createHistory({
            entityType: 'POOL',
            entityId: ride.poolId,
            fromStatus: pool.status,
            toStatus: 'CANCELLED',
            changedBy: null, // system — nobody chose this; the roster emptied
            reason: CANCEL_REASONS.poolEmpty,
          });
          poolStatus = 'CANCELLED';
        }

        const fresh = await rides.findOwnedRide(passengerId, rideId);
        return {
          id: rideId,
          status: fresh?.status ?? 'CANCELLED',
          poolId: ride.poolId,
          poolStatus,
          seats: ride.seats,
          reason: reason ?? null,
          createdAt: ride.createdAt.toISOString(),
        };
      });
    },

    /**
     * `GET /rides/:id/payment` (api.md §8) — the current payment row.
     *
     * A payment only exists after pool completion, so a ride that has not
     * completed answers the documented `404` rather than a fabricated
     * "PENDING" the passenger could then try to pay.
     */
    async getPayment(passengerId, rideId): Promise<PaymentView> {
      const rides = createRidesRepository(root());
      const ride = await rides.findOwnedRide(passengerId, rideId);
      if (!ride) throw new NotFoundError('Ride not found.');
      const payment = await rides.findPayment(rideId);
      if (!payment) throw new NotFoundError('No payment exists for this ride yet.');
      return toPaymentView(payment);
    },

    /**
     * `POST /rides/:id/payment/simulate` (api.md §8) — `PENDING → PAID`.
     *
     * Idempotent by design: a repeat returns the same `PAID` row (`UNIQUE
     * (ride_request_id)` means there is only ever one payment per ride), and a
     * ride that has not completed is refused with the documented
     * `409 ILLEGAL_STATE_TRANSITION`. `SIMULATED` is the MVP's stand-in for a
     * gateway call (PRD §13 — no real processor in the MVP).
     */
    async simulatePayment(passengerId, rideId): Promise<PaymentView> {
      return db().prisma.$transaction(async (tx) => {
        const rides = createRidesRepository(tx);
        const ride = await rides.findOwnedRide(passengerId, rideId);
        if (!ride) throw new NotFoundError('Ride not found.');

        const payment = await rides.findPayment(rideId);
        // No payment row ⇒ the trip never completed, so there is nothing to pay.
        if (!payment || ride.status !== 'COMPLETED') {
          throw new ConflictError(
            'ILLEGAL_STATE_TRANSITION',
            'A ride can only be paid once it is COMPLETED.',
            { current: ride.status, expected: 'COMPLETED' },
          );
        }
        // Already paid — the endpoint's natural idempotency (api.md §8).
        if (payment.status === 'PAID') return toPaymentView(payment);
        return toPaymentView(await rides.markPaymentPaid(payment.id));
      });
    },
  };
}
