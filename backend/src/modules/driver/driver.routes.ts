import { Router, type RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import type { Role } from '../../generated/prisma/client.js';
import { createDriverController } from './driver.controller.js';

export interface DriverRouterDependencies {
  database?: Database;
  authenticate: RequestHandler;
  authorize: (...roles: Role[]) => RequestHandler;
}

/**
 * Routes per api.md §6 + §10: every driver endpoint requires a Bearer access
 * token **and** the DRIVER role (a passenger calling `/driver/pools/:id/accept`
 * answers 403), mounted at `/api/v1`.
 *
 * Pool ids are UUID-validated here and ownership-scoped in the service, so a
 * foreign or unknown id is a plain 404 (api.md §1 — no ID probing).
 * `/driver/pools/:id/cancel` lands in Phase 8 (todo.md).
 */
export function createDriverRouter({
  database,
  authenticate,
  authorize,
}: DriverRouterDependencies): Router {
  const router = Router();
  const controller = createDriverController({ database });

  router.get('/driver/pools', authenticate, authorize('DRIVER'), controller.list);
  router.get('/driver/pools/:id', authenticate, authorize('DRIVER'), controller.detail);
  router.post('/driver/pools/:id/accept', authenticate, authorize('DRIVER'), controller.accept);
  router.post('/driver/pools/:id/arrive', authenticate, authorize('DRIVER'), controller.arrive);
  router.post('/driver/pools/:id/start', authenticate, authorize('DRIVER'), controller.start);
  router.post('/driver/pools/:id/complete', authenticate, authorize('DRIVER'), controller.complete);
  // api.md §6.5 — the driver's no-show / breakdown path, pre-STARTED only.
  router.post('/driver/pools/:id/cancel', authenticate, authorize('DRIVER'), controller.cancel);

  return router;
}
