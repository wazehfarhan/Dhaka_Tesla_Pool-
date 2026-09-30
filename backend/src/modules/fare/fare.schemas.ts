import { z } from 'zod';

/**
 * Input validation for `POST /fare/estimate` (api.md §4) — strict by FR-FARE-004:
 * clients can never submit amounts (or any field at all beyond the three below).
 * Zone names are trimmed strings (length mirrors `zones.name` VARCHAR(40));
 * `seats` is checked against the vehicle's capacity in the service, not here —
 * the capacity lives with the vehicle, not in a schema constant.
 */
export const fareEstimateSchema = z.strictObject({
  pickupZone: z.string().trim().min(1).max(40),
  destinationZone: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1),
});

export type FareEstimateInput = z.infer<typeof fareEstimateSchema>;
