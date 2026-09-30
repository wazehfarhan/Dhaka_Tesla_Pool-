/**
 * Wire types — a hand-mirrored copy of the API contract (api.md §2–§5).
 *
 * The frontend never guesses a field: every property here is read straight off a
 * documented response, or is `null` because the API says it can be (a live ride
 * has no payment yet, a distance can be missing on an old row). Keeping this file
 * small and explicit is the cost of not sharing a package with the backend in an
 * MVP — and it doubles as the reviewer's checklist of what the UI consumes.
 */

export type Role = 'PASSENGER' | 'DRIVER';

/** Ride lifecycle (database.md §3 — the brief's REQUESTED → … → COMPLETED chain). */
export type RideStatus =
  'REQUESTED' | 'ACCEPTED' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';

/** Pool lifecycle; `OPEN` is the pre-acceptance phase. */
export type PoolStatus =
  'OPEN' | 'ACCEPTED' | 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';

export type FareStatus = 'ESTIMATED' | 'FINAL';
export type PaymentStatus = 'PENDING' | 'PAID';

/** `GET /auth/me`, `POST /auth/login` — `passwordHash` is never serialised. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** `GET /zones` (public dropdown data). */
export interface Zone {
  id: number;
  name: string;
}

/** `POST /fare/estimate` — the live estimate behind the request form (api.md §4). */
export interface FareEstimate {
  distanceKm: number;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPercent: number;
  estimatedDiscountPoisha: number;
  perSeatPoisha: number;
  totalDuePoisha: number;
  currency: string;
  assumesPoolSize: number;
  seatCapacity: number;
  poolAvailableSeats: number;
}

/** `POST /rides` body (api.md §5.1; `clientRequestId` is the idempotency key). */
export interface CreateRideRequest {
  pickupZone: string;
  destinationZone: string;
  seats: number;
  clientRequestId: string;
}

/** `POST /rides` → `201` fresh, `200` on an idempotent replay. */
export interface CreatedRide {
  id: string;
  status: RideStatus;
  poolId: string;
  seats: number;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number;
  estimate: {
    perSeatPoisha: number;
    totalDuePoisha: number;
    currency: string;
  };
  createdAt: string;
}

/** One row of `GET /rides` (FR-HISTORY-001: fare + payment status per row). */
export interface RideListItem {
  id: string;
  status: RideStatus;
  poolId: string;
  seats: number;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  fare: {
    status: FareStatus;
    totalPoisha: number;
    currency: string;
  } | null;
  payment: {
    status: PaymentStatus;
    amountPoisha: number;
  } | null;
  createdAt: string;
}

/** `GET /rides/:id` — ride + pool summary + timeline + money (api.md §5.3). */
export interface RideDetail {
  id: string;
  status: RideStatus;
  poolId: string;
  seats: number;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  pool: {
    id: string;
    status: PoolStatus;
    seatsTaken: number;
    seatCapacity: number;
    memberCount: number;
  };
  timeline: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
  fare: {
    status: FareStatus;
    baseFarePoisha: number;
    distanceChargePoisha: number;
    subtotalPoisha: number;
    poolDiscountPoisha: number;
    totalPoisha: number;
    currency: string;
  } | null;
  payment: {
    status: PaymentStatus;
    amountPoisha: number;
  } | null;
  createdAt: string;
}

/** Shared envelope (api.md §1). Lists add `meta`; errors replace `data`. */
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: { page: number; limit: number; total: number };
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}
