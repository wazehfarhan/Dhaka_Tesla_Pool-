/**
 * Driver value objects — api.md §6.1–6.4, FR-HISTORY-002.
 *
 * One member shape serves the pool detail roster and every transition
 * response; `complete` (api.md §6.4's example) is the same shape with FINAL
 * fares and `PENDING` payments, while earlier transitions honestly carry the
 * `ESTIMATED` fare and a `null` payment (no payment row exists yet).
 */
export interface PoolMemberView {
  rideId: string;
  passenger: string;
  seats: number;
  /** The member's own ride status — the pool status mirrored per passenger. */
  status: string;
  fare: {
    status: string;
    subtotalPoisha: number;
    poolDiscountPoisha: number;
    totalPoisha: number;
  } | null;
  payment: {
    status: string;
    amountPoisha: number;
  } | null;
}

/** `GET /driver/pools` row — the Requests queue, active trip and history (api.md §6.1). */
export interface DriverPoolListItem {
  id: string;
  status: string;
  pickupZone: string;
  destinationZone: string;
  distanceKm: number | null;
  seatsTaken: number;
  seatCapacity: number;
  members: Array<{ passenger: string; seats: number; status: string }>;
  createdAt: string;
}

/** `GET /driver/pools/:id` — full roster + money side + pool timeline (api.md §6.2). */
export interface DriverPoolDetail {
  id: string;
  status: string;
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

/** The `200` body of `POST /driver/pools/:id/accept|arrive|start|complete` (api.md §6.3–6.4). */
export interface TransitionResponse {
  id: string;
  status: string;
  members: PoolMemberView[];
}

/**
 * The `200` body of `POST /driver/pools/:id/cancel` (api.md §6.5) — the same
 * `TransitionResponse` shape with the pool `CANCELLED` and every active member
 * cancelled along with it (PRD §14: no-show / breakdown cancels the whole trip).
 */
export type PoolCancelResponse = TransitionResponse;
