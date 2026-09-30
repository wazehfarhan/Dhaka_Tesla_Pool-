import { z } from 'zod';

/**
 * `POST /rides` input (api.md §5.1) — strict on purpose: the client states
 * *where* and *how many*, never *how much* and never anything the server owns
 * (`poolId`, `status`, `fare`…). An unknown key is a 400, not a silently
 * ignored field (FR-FARE-004's principle applied to the request form).
 *
 * `seats` is only bounded below: the real ceiling is the vehicle's capacity,
 * which lives with the vehicle and is enforced by matching + the atomic claim
 * (FR-POOL-004).
 *
 * `clientRequestId` is the per-passenger idempotency key — a UUID, matching the
 * `uuid` column it is stored in; replaying it returns the original ride with
 * `200` instead of creating a second one (api.md §5.1).
 */
export const createRideSchema = z.strictObject({
  pickupZone: z.string().trim().min(1).max(40),
  destinationZone: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1),
  clientRequestId: z.uuid().optional(),
});

export type CreateRideInput = z.infer<typeof createRideSchema>;

/**
 * Ride lookup endpoints (api.md §5.2–5.3) — ownership-scoped list/detail for
 * live dashboards and histories (FR-HISTORY-001).
 *
 * The status filter is deliberately *lenient*: `z.enum` would 400 on unknown
 * values, but the contract's quick reference lists only paging, and unknown
 * statuses read more honestly as an empty filtered page than as a rejection.
 * Unrecognised statuses therefore match zero rides (same envelope as a real
 * filter with no rows), and only negative paging is a 400.
 */
export const listRidesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(20).optional(),
});

export type ListRidesQuery = z.infer<typeof listRidesQuerySchema>;

/** Ride detail path param — a UUID string; unknown/foreign ids answer 404 (api.md §1). */
export const rideIdParamSchema = z.object({
  id: z.uuid(),
});

export type RideIdParam = z.infer<typeof rideIdParamSchema>;

/**
 * `POST /rides/:id/cancel` body (api.md §5.4) — `{ "reason": "optional text" }`.
 *
 * The whole body is optional, so an empty body is a valid "cancel it" and a
 * missing `req.body` (some clients send none) is normalised to `{}` in the
 * controller. The reason is free text for the operator's benefit; the stored
 * history reason stays the closed-set `PASSENGER_CANCELLED` (PRD §14).
 */
export const cancelRideSchema = z.strictObject({
  reason: z.string().trim().max(200).optional(),
});

export type CancelRideInput = z.infer<typeof cancelRideSchema>;
