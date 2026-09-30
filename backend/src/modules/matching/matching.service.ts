import type { Database } from '../../db/client.js';
import {
  ActiveRideExistsError,
  ConflictError,
  NoVehicleAvailableError,
  PoolCapacityExceededError,
  SameZoneError,
  ValidationError,
} from '../../shared/errors.js';
import { createMatchingRepository, type MatchingClient } from './matching.repository.js';
import type {
  MatchDecision,
  MatchInput,
  MatchOutcome,
  OnlineVehicle,
  OpenPoolCandidate,
} from './matching.types.js';

/**
 * Matching domain — PRD §11, requirements FR-POOL-001…004.
 *
 * `decideMatch` is the pure five-condition decision table (testing.md §3 wants
 * it unit-tested without HTTP or DB). `createMatchedRide` is the transactional
 * orchestrator for architecture.md §6 steps 3–6: match → atomic claim → persist
 * the ride row + seat ledger, plus the racing-creator retry. Phase 4's
 * `POST /rides` will call it with a `persist` hook that writes the fare
 * estimate (and later status history) inside the same transaction (step 7).
 */

/**
 * PRD §11 — a request joins an existing OPEN pool iff all five conditions hold:
 * (1) pool `OPEN`, (2) same ordered corridor, (3) seats fit, (4) vehicle
 * `ONLINE`, (5) caller has no other active ride (checked by the orchestrator —
 * it is a property of the caller, not of a candidate pool).
 *
 * Fallback order per PRD §11: an ONLINE pool exists for the corridor but none
 * can seat the request → `POOL_CAPACITY_EXCEEDED` (MVP: one vehicle per
 * corridor, api.md §5.1); otherwise create a pool on an `ONLINE` vehicle — or
 * reject `NO_VEHICLE_AVAILABLE` when nothing is online / nothing fits.
 *
 * Pure: no I/O — candidates arrive oldest-first from the repository and the
 * first joinable one wins (deterministic tie-break).
 */
export function decideMatch(
  candidates: readonly OpenPoolCandidate[],
  seats: number,
  onlineVehicle: OnlineVehicle | null,
): MatchDecision {
  const joinable = candidates.find(
    (pool) => pool.vehicle.status === 'ONLINE' && pool.seatsTaken + seats <= pool.seatCapacity,
  );
  if (joinable) return { action: 'JOIN', poolId: joinable.id };

  // Some ONLINE candidate exists but none fits → the corridor pool is full.
  if (candidates.some((pool) => pool.vehicle.status === 'ONLINE')) {
    return { action: 'REJECT', code: 'POOL_CAPACITY_EXCEEDED' };
  }

  // Creating requires an ONLINE vehicle that seats every requested passenger.
  if (!onlineVehicle) return { action: 'REJECT', code: 'NO_VEHICLE_AVAILABLE' };
  if (seats > onlineVehicle.seatCapacity) {
    return { action: 'REJECT', code: 'POOL_CAPACITY_EXCEEDED' };
  }
  return { action: 'CREATE' };
}

/**
 * Internal signal: our pool INSERT lost a race — the partial unique index
 * `idx_unique_open_pool_per_corridor` rejected it. Not an API outcome: the
 * orchestrator restarts the transaction once and joins the winner's pool
 * (PRD §11 / architecture §6 step 4).
 */
class PoolCorridorConflict extends Error {
  constructor() {
    super('A racing request created the corridor OPEN pool first.');
    this.name = 'PoolCorridorConflict';
  }
}

/** Prisma's unique-violation code — the test fake throws the same shape. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

/**
 * Rows Phase 4 adds inside the *same* transaction (fare estimate, creation
 * status history — architecture §6 step 7). Runs after the ride + member exist;
 * a throw rolls the whole claim back.
 */
export type PersistHook = (tx: MatchingClient, outcome: MatchOutcome) => Promise<void>;

/** One attempt: everything below runs in a single interactive transaction. */
async function matchOnce(
  db: Database,
  input: MatchInput,
  persist?: PersistHook,
): Promise<MatchOutcome> {
  return db.prisma.$transaction(async (tx) => {
    const repository = createMatchingRepository(tx);

    // Defensive guards (Zod in Phase 4 owns the 400s for POST /rides).
    if (input.pickupZoneId === input.destinationZoneId) throw new SameZoneError();
    if (!Number.isInteger(input.seats) || input.seats < 1) {
      throw new ValidationError('seats must be a positive integer.');
    }

    // Condition 5 — the caller already holds a non-terminal ride (Assumption A-06).
    if (await repository.findActiveRide(input.passengerId)) throw new ActiveRideExistsError();

    const candidates = await repository.findCorridorPools(
      input.pickupZoneId,
      input.destinationZoneId,
    );
    const onlineVehicle = await repository.findOnlineVehicle();
    const decision = decideMatch(candidates, input.seats, onlineVehicle);

    if (decision.action === 'REJECT') {
      throw decision.code === 'POOL_CAPACITY_EXCEEDED'
        ? new PoolCapacityExceededError()
        : new NoVehicleAvailableError();
    }

    let poolId: string;
    let createdPool = false;
    let seatCapacity: number;
    let seatsTaken: number;

    if (decision.action === 'JOIN') {
      const targetPoolId = decision.poolId;
      const candidate = candidates.find((pool) => pool.id === targetPoolId);
      // Vanished between read and claim → treat exactly like a lost claim race.
      if (!candidate) throw new PoolCapacityExceededError();
      const claim = await repository.claimSeats(candidate.id, input.seats);
      // 0 rows ⇒ another transaction took the seat first ⇒ ROLLBACK (architecture §7).
      if (!claim) throw new PoolCapacityExceededError();
      poolId = candidate.id;
      seatsTaken = claim.seatsTaken;
      seatCapacity = candidate.seatCapacity;
    } else {
      // decideMatch only returns CREATE with a non-null online vehicle.
      if (!onlineVehicle) throw new NoVehicleAvailableError();
      try {
        const pool = await repository.createPool({
          driverId: onlineVehicle.ownerId, // pool driver = vehicle owner (database.md §3.5)
          vehicleId: onlineVehicle.id,
          pickupZoneId: input.pickupZoneId,
          destinationZoneId: input.destinationZoneId,
          seatCapacity: onlineVehicle.seatCapacity,
        });
        poolId = pool.id;
        createdPool = true;
        seatCapacity = pool.seatCapacity;
      } catch (error) {
        // Racing creator won the partial unique index → restart & join theirs.
        if (isUniqueViolation(error)) throw new PoolCorridorConflict();
        throw error;
      }
      const claim = await repository.claimSeats(poolId, input.seats);
      // Seats were pre-checked against this capacity — a miss here can only mean
      // an inconsistent read; the rollback below removes the just-created pool.
      if (!claim) throw new PoolCapacityExceededError();
      seatsTaken = claim.seatsTaken;
    }

    // architecture §6 step 6 — ride row + seat ledger, same transaction.
    const ride = await repository.createRideRequest({
      passengerId: input.passengerId,
      poolId,
      pickupZoneId: input.pickupZoneId,
      destinationZoneId: input.destinationZoneId,
      seats: input.seats,
      clientRequestId: input.clientRequestId ?? null,
    });

    try {
      await repository.createPoolMember({ poolId, rideRequestId: ride.id, seats: input.seats });
    } catch (error) {
      // "Cannot happen" safety net with a defined response (api.md §1):
      // a request holds at most one membership (UNIQUE ride_request_id).
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'DUPLICATE_MEMBERSHIP',
          'This ride already holds a seat in a pool.',
        );
      }
      throw error;
    }

    const outcome: MatchOutcome = {
      poolId,
      rideRequestId: ride.id,
      joinedExistingPool: !createdPool,
      seatsTaken,
      seatCapacity,
      createdAt: ride.createdAt,
    };
    await persist?.(tx, outcome);
    return outcome;
  });
}

/**
 * Create the ride's pool membership — the public entry for Phase 4's
 * `POST /rides` (api.md §5.1: validate → match/create → atomic claim →
 * persist, one transaction; FR-POOL-001…004).
 *
 * The unique-violation retry runs *outside* the transaction: a failed INSERT
 * aborts a Postgres transaction, so the re-run must begin a fresh one —
 * architecture §6 step 4 ("re-run step 3 once and join instead"). By the time
 * a unique violation surfaces, the winner has committed, so the second
 * attempt's corridor query finds (and joins) the winner's pool.
 */
export async function createMatchedRide(
  db: Database,
  input: MatchInput,
  persist?: PersistHook,
): Promise<MatchOutcome> {
  try {
    return await matchOnce(db, input, persist);
  } catch (error) {
    if (!(error instanceof PoolCorridorConflict)) throw error;
  }

  // One retry — converge on the racing creator's pool (FR-POOL-001 acceptance).
  try {
    return await matchOnce(db, input, persist);
  } catch (error) {
    if (error instanceof PoolCorridorConflict) {
      // Cannot happen (winner committed before our violation surfaced) — but the
      // error contract demands a defined response for even impossible paths.
      throw new ConflictError('CONFLICT', 'The corridor pool changed while matching; retry.');
    }
    throw error;
  }
}
