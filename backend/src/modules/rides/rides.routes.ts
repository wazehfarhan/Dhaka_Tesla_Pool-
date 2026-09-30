import { Router, type RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import type { Role } from '../../generated/prisma/client.js';
import { createRidesController } from './rides.controller.js';

export interface RidesRouterDependencies {
  database?: Database;
  authenticate: RequestHandler;
  authorize: (...roles: Role[]) => RequestHandler;
}

/**
 * Routes per api.md §5 + §10: every passenger ride endpoint requires a Bearer
 * access token **and** the PASSENGER role (a driver calling `POST /rides`
 * answers 403), mounted at `/api/v1`.
 *
 * `/rides/:id` is UUID-validated in the controller, and the service resolves it
 * within the caller's ownership scope, so a foreign or unknown id is a plain 404
 * (api.md §1).
 */
export function createRidesRouter({
  database,
  authenticate,
  authorize,
}: RidesRouterDependencies): Router {
  const router = Router();
  const controller = createRidesController({ database });

  router.post('/rides', authenticate, authorize('PASSENGER'), controller.create);
  router.get('/rides', authenticate, authorize('PASSENGER'), controller.list);
  router.get('/rides/:id', authenticate, authorize('PASSENGER'), controller.detail);
  // api.md §5.4 — the passenger's own pre-start cancel.
  router.post('/rides/:id/cancel', authenticate, authorize('PASSENGER'), controller.cancel);
  // api.md §8 — simulated payment: read the row, or settle it (idempotent).
  router.get('/rides/:id/payment', authenticate, authorize('PASSENGER'), controller.payment);
  router.post(
    '/rides/:id/payment/simulate',
    authenticate,
    authorize('PASSENGER'),
    controller.simulatePayment,
  );

  return router;
}
