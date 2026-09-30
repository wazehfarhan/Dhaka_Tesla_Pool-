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

/** `GET`/`POST /rides/:id/payment` and `POST …/payment/simulate` (api.md §8). */
export interface Payment {
  id: string;
  rideId: string;
  amountPoisha: number;
  currency: string;
  status: PaymentStatus;
  /** `SIMULATED` in the MVP — there is no real gateway (PRD §13). */
  method: string;
  paidAt: string | null;
}

/** `POST /rides/:id/cancel` (api.md §5.4) — the ride plus its pool's new state. */
export interface CancelledRide {
  id: string;
  status: RideStatus;
  poolId: string;
  poolStatus: PoolStatus;
  seats: number;
  reason: string | null;
  createdAt: string;
}

/* ---------------------------------------------------------------- driver ---- */

export type VehicleStatus = 'ONLINE' | 'OFFLINE';

/** `GET`/`POST /vehicles` row (api.md §7.1) — the driver's garage. */
export interface VehicleSummary {
  id: string;
  model: string;
  plate: string;
  seatCapacity: number;
  status: VehicleStatus;
}

/** `PATCH /vehicles/:id` answers only the id and the new status (api.md §7.2). */
export interface VehicleStatusResponse {
  id: string;
  status: VehicleStatus;
}

/** One member of a driver pool roster — passenger, seats, status, money (api.md §6.2). */
export interface PoolMemberView {
  rideId: string;
  passenger: string;
  seats: number;
  status: RideStatus;
  fare: {
    status: FareStatus;
    subtotalPoisha: number;
    poolDiscountPoisha: number;
    totalPoisha: number;
  } | null;
  payment: { status: PaymentStatus; amountPoisha: number } | null;
}

/** One row of `GET /driver/pools` — the Requests queue, the active trip, history. */
export interface DriverPoolListItem {
  id: string;
  status: PoolStatus;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  seatsTaken: number;
  seatCapacity: number;
  members: Array<{ passenger: string; seats: number; status: RideStatus }>;
  createdAt: string;
}

/** `GET /driver/pools/:id` — pool + full roster + the pool's own timeline. */
export interface DriverPoolDetail {
  id: string;
  status: PoolStatus;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  seatsTaken: number;
  seatCapacity: number;
  members: PoolMemberView[];
  timeline: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
  createdAt: string;
}

/**
 * The body of every `POST /driver/pools/:id/{action}` (api.md §6.3–6.5): the pool
 * after the transition plus the roster re-read inside the same transaction, so
 * the UI never has to guess what a cascade did.
 */
export interface DriverTransitionResponse {
  id: string;
  status: PoolStatus;
  members: PoolMemberView[];
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
