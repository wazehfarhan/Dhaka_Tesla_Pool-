/**
 * Pool-matching value objects — PRD §11, requirements FR-POOL-001…004.
 *
 * Matching operates on *resolved zone ids* (`POST /rides` validates names → ids
 * first, api.md §5.1) over the ordered corridor (pickup, destination). The
 * decision itself is pure (testing.md §3); the transactional orchestration
 * lives in `matching.service.ts`.
 */
import type { VehicleStatus } from '../../generated/prisma/client.js';

/** The passenger's ask, once the endpoint has validated and resolved it. */
export interface MatchInput {
  passengerId: string;
  pickupZoneId: number;
  destinationZoneId: number;
  seats: number;
  /** Idempotency key stored on the ride row; replay *detection* belongs to Phase 4. */
  clientRequestId?: string;
}

/** An OPEN pool on the corridor with its vehicle joined — conditions 1–4. */
export interface OpenPoolCandidate {
  id: string;
  seatsTaken: number;
  seatCapacity: number;
  vehicle: { id: string; status: VehicleStatus };
}

/** A vehicle that could host a brand-new pool (condition 4 on the creation path). */
export interface OnlineVehicle {
  id: string;
  ownerId: string;
  seatCapacity: number;
}

/** The pure result of PRD §11's decision table — no I/O, fully unit-testable. */
export type MatchDecision =
  | { action: 'JOIN'; poolId: string }
  | { action: 'CREATE' }
  | { action: 'REJECT'; code: 'POOL_CAPACITY_EXCEEDED' | 'NO_VEHICLE_AVAILABLE' };

/** What one `createMatchedRide` produced inside its transaction. */
export interface MatchOutcome {
  poolId: string;
  rideRequestId: string;
  /** false when this request created the pool instead of joining one (FR-POOL-001). */
  joinedExistingPool: boolean;
  /** `seats_taken` *after* the atomic claim (architecture §7 `RETURNING`). */
  seatsTaken: number;
  /** The pool's capacity snapshot (database.md §3.5). */
  seatCapacity: number;
  /** The persisted ride's `created_at` — what api.md §5.1 returns as `createdAt`. */
  createdAt: Date;
}
