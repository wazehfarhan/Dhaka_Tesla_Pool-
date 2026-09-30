import type { RideStatus } from '../../generated/prisma/client.js';

/**
 * Ride value objects — api.md §5.1–5.3, FR-POOL-001…004.
 *
 * `POST /rides` answers 201 with the ride id, the pool it landed in, and the
 * pooled estimate (Banani → Dhanmondi: 11520). Prisma returns Dates; the
 * controller serialises them to ISO strings at the edge.
 */
export interface CreateRideResponse {
  id: string;
  /** `REQUESTED` on every fresh ride — a replay echoes the ride's *current* status. */
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

/**
 * One row of `GET /rides` — the same live/history item the dashboards render:
 * corridor, seat count, current status **and** the money side, which
 * FR-HISTORY-001 requires per row ("each with corridor, dates, status, seats,
 * final/estimated fare, payment status").
 *
 * `fare` is present from the moment a ride exists (it is written ESTIMATED in
 * the creation transaction); `payment` only exists after pool completion, so a
 * live ride honestly reports `null` there.
 */
export interface RideListItem {
  id: string;
  status: string;
  poolId: string;
  seats: number;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  fare: {
    status: string;
    totalPoisha: number;
    currency: string;
  } | null;
  payment: {
    status: string;
    amountPoisha: number;
  } | null;
  createdAt: string;
}

/**
 * The `200` body of `POST /rides/:id/cancel` (api.md §5.4) — the cancelled ride
 * plus its pool's new state, so the UI can explain "you left; the trip is off"
 * (pool `CANCELLED`) or "the others are still going" (pool unchanged) without a
 * second round trip.
 */
export interface RideCancelResponse {
  id: string;
  status: string;
  poolId: string;
  /** The pool's status after the cancellation — `CANCELLED` only if it emptied. */
  poolStatus: string;
  seats: number;
  /** The caller's optional note (api.md §5.4 body), echoed back. */
  reason: string | null;
  createdAt: string;
}

/**
 * `GET /rides/:id/payment` and `POST /rides/:id/payment/simulate` (api.md §8).
 * `currency` is always `BDT` and amounts are integer poisha (ADR-003) — the API
 * never sends formatted money, the client renders it.
 */
export interface PaymentView {
  id: string;
  rideId: string;
  amountPoisha: number;
  currency: string;
  status: string;
  method: string;
  paidAt: string | null;
}

/** `GET /rides/:id` — ride + pool summary, timeline, fare, payment (api.md §5.3). */
export interface RideDetail {
  id: string;
  status: string;
  poolId: string;
  seats: number;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  pool: {
    id: string;
    status: string;
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
    status: string;
    baseFarePoisha: number;
    distanceChargePoisha: number;
    subtotalPoisha: number;
    poolDiscountPoisha: number;
    totalPoisha: number;
    currency: string;
  } | null;
  payment: {
    status: string;
    amountPoisha: number;
  } | null;
  createdAt: string;
}
