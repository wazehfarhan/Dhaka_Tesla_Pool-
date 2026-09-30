import { Router } from 'express';
import type { Database } from '../../db/client.js';
import { createZonesController } from './zones.controller.js';

/**
 * Routes per api.md §3: `GET /zones` is public (🔓) — passengers must be able to
 * pick them up before they hold a token. Mounted at `/api/v1`.
 */
export function createZonesRouter({ database }: { database?: Database }): Router {
  const router = Router();
  const controller = createZonesController({ database });

  router.get('/zones', controller.list);

  return router;
}
