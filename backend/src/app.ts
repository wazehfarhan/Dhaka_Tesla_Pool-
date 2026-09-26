import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import type { AppLogger } from './shared/logger.js';

export interface AppDependencies {
  env: Pick<Env, 'CORS_ORIGIN'>;
  logger: AppLogger;
}

/**
 * The Express application, assembled in the middleware order documented in
 * security.md §5: CORS → helmet → body parse → routes → 404 → error handler.
 *
 * Rate limiting and authentication middleware join this pipeline in Phase 3; they are
 * deliberately absent rather than stubbed, so nothing pretends to be enforced.
 */
export function createApp({ env, logger }: AppDependencies): Express {
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
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1', createHealthRouter());

  // Order matters: these two are always last.
  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
