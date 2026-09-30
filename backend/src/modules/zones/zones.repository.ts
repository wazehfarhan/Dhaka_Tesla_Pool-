import type { Database } from '../../db/client.js';

/**
 * Read-only geography repository — api.md §3 (`GET /zones`).
 *
 * No business decisions here: the zones list is reference data straight from
 * the table (id, name), ordered by id, matching the documented envelope
 * `{data:[{id,name}…]}`.
 */
export function createZonesRepository(prisma: Database['prisma']) {
  return {
    /** All zones ordered by id — the seed order is the display order. */
    async listZones() {
      return prisma.zone.findMany({ orderBy: { id: 'asc' } });
    },
  };
}
