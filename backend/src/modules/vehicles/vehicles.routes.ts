import { Router, type RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import type { Role } from '../../generated/prisma/client.js';
import { createVehiclesController } from './vehicles.controller.js';

export interface VehiclesRouterDependencies {
  database?: Database;
  authenticate: RequestHandler;
  authorize: (...roles: Role[]) => RequestHandler;
}

/**
 * Routes per api.md §7: the whole vehicle registry is DRIVER-only, so a
 * passenger token answers 403 (api.md §1 — genuine role mismatch).
 * Mounted at `/api/v1`.
 */
export function createVehiclesRouter({
  database,
  authenticate,
  authorize,
}: VehiclesRouterDependencies): Router {
  const router = Router();
  const controller = createVehiclesController({ database });

  router.get('/vehicles', authenticate, authorize('DRIVER'), controller.list);
  router.post('/vehicles', authenticate, authorize('DRIVER'), controller.create);
  router.patch('/vehicles/:id', authenticate, authorize('DRIVER'), controller.update);

  return router;
}
