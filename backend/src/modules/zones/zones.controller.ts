import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { createZoneService } from './zones.service.js';

/**
 * Zones HTTP layer (api.md §3): the only read in the stack that takes no input —
 * no schema to parse, the service builds the envelope-ready rows directly.
 */
export function createZonesController({ database }: { database?: Database }): {
  list: RequestHandler;
} {
  const service = createZoneService({ database });

  const list: RequestHandler = async (_req, res) => {
    const zones = await service.listZones();
    res.status(200).json({ success: true, data: zones });
  };

  return { list };
}
