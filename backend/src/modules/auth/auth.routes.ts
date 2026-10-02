import { Router, type RequestHandler } from 'express';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { createAuthController } from './auth.controller.js';
import { createAuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';

export interface AuthRouterDependencies {
  database?: Database;
  env: Pick<Env, 'CORS_ORIGIN' | 'NODE_ENV' | 'COOKIE_SAMESITE'>;
  tokens: TokenService;
  authenticate: RequestHandler;
}

/**
 * Routes per api.md §2, mounted at `/api/v1`:
 * register/login are public; refresh/logout are cookie-authenticated (and
 * Origin-checked in the controller); `/me` requires a Bearer access token.
 */
export function createAuthRouter({
  database,
  env,
  tokens,
  authenticate,
}: AuthRouterDependencies): Router {
  const router = Router();

  const service = createAuthService({ database, tokens });
  const controller = createAuthController({ service, env });

  router.post('/auth/register', controller.register);
  router.post('/auth/login', controller.login);
  router.post('/auth/refresh', controller.refresh);
  router.post('/auth/logout', controller.logout);
  router.get('/auth/me', authenticate, controller.me);

  return router;
}
