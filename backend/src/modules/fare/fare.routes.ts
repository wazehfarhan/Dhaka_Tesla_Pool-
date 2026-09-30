import { Router, type RequestHandler } from 'express';
import type { Role } from '../../generated/prisma/client.js';
import type { Database } from '../../db/client.js';
import { createFareController } from './fare.controller.js';

export interface FareRouterDependencies {
  database?: Database;
  authenticate: RequestHandler;
  authorize: (...roles: Role[]) => RequestHandler;
}

/**
 * Routes per api.md §4 + §10: `POST /fare/estimate` requires a Bearer access
 * token and the PASSENGER role, mounted at `/api/v1`.
 */
export function createFareRouter({
  database,
  authenticate,
  authorize,
}: FareRouterDependencies): Router {
  const router = Router();
  const controller = createFareController({ database });

  router.post('/fare/estimate', authenticate, authorize('PASSENGER'), controller.estimate);

  return router;
}
