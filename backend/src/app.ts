import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { createRateLimiters } from './middleware/rate-limit.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createTokenService } from './modules/auth/token.service.js';
import { createFareRouter } from './modules/fare/fare.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createRidesRouter } from './modules/rides/rides.routes.js';
import { createZonesRouter } from './modules/zones/zones.routes.js';
import type { AppLogger } from './shared/logger.js';

export interface AppDependencies {
  env: Pick<Env, 'CORS_ORIGIN' | 'NODE_ENV' | 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'>;
  logger: AppLogger;
  database?: Database;
}

/**
 * The Express application, assembled in the middleware order documented in
 * security.md §5: CORS → helmet → rate limit → body parse → authenticate →
 * authorize → controller → 404 → error handler.
 */
export function createApp({ env, logger, database }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      // One id per request, echoed back so logs and client reports can be correlated.
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header !== '' ? header : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()),
      credentials: true,
    }),
  );

  app.use(helmet());

  // Rate limiting runs before body parsing: a flood never reaches JSON decoding.
  const { general, auth } = createRateLimiters();
  app.use(general);
  app.use('/api/v1/auth', auth);

  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokenService(env);
  const { authenticate, authorize } = createAuthMiddleware(tokens);

  app.use('/api/v1', createHealthRouter(database));
  app.use('/api/v1', createAuthRouter({ database, env, tokens, authenticate }));
  app.use('/api/v1', createFareRouter({ database, authenticate, authorize }));
  app.use('/api/v1', createZonesRouter({ database }));
  app.use('/api/v1', createRidesRouter({ database, authenticate, authorize }));

  // Order matters: these two are always last.
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
