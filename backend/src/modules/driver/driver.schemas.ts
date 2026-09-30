import { z } from 'zod';

/**
 * Driver endpoints input (api.md §6) — same shape decisions as the passenger
 * list: lenient status filter (unknown value = empty page, never a 400) and a
 * UUID pool id so a malformed id is a 400 before any lookup (api.md §1).
 */
export const listPoolsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(20).optional(),
});

export type ListPoolsQuery = z.infer<typeof listPoolsQuerySchema>;

/** Pool detail path param — foreign/unknown ids answer 404 inside the service (api.md §6). */
export const poolIdParamSchema = z.object({
  id: z.uuid(),
});

export type PoolIdParam = z.infer<typeof poolIdParamSchema>;
