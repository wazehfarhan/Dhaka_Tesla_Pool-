import { z } from 'zod';

/**
 * Vehicle registry input (api.md §7) — the driver states model/plate/capacity;
 * `seatCapacity` is bounded to 1…8 exactly as the contract's 400 documents.
 * Unknown keys are a 400, not silently ignored (same strictness as POST /rides).
 */
export const createVehicleSchema = z.strictObject({
  model: z.string().trim().min(1).max(60),
  plate: z.string().trim().min(1).max(20),
  seatCapacity: z.number().int().min(1).max(8),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/** The online toggle (api.md §7.2) — the only field a PATCH may change. */
export const updateVehicleSchema = z.strictObject({
  status: z.enum(['ONLINE', 'OFFLINE']),
});

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

/** Vehicle path param — a foreign or unknown id answers 404 (api.md §1). */
export const vehicleIdParamSchema = z.object({
  id: z.uuid(),
});

export type VehicleIdParam = z.infer<typeof vehicleIdParamSchema>;
