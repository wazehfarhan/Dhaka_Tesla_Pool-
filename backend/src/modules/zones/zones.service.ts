/**
 * Zones module — api.md §3 (public `GET /api/v1/zones`).
 *
 * Zones are reference data seeded from prisma/seed.ts (database.md §3.1):
 * controllers parse nothing, services decide nothing, repositories own Prisma.
 */
import type { Database } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { createZonesRepository } from './zones.repository.js';

export function createZoneService({ database }: { database?: Database }) {
  const prisma = () => {
    // Honest failure, matching fare/rides: no database → 500, never a made-up list.
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database.prisma;
  };

  return {
    /** Reference-data list, insertion order (seed order == id order, database §3.1). */
    async listZones(): Promise<ReadonlyArray<{ id: number; name: string }>> {
      return createZonesRepository(prisma()).listZones();
    },
  };
}

export type ZoneService = ReturnType<typeof createZoneService>;
