import { Router } from 'express';
import type { Database } from '../../db/client.js';

/**
 * Probes documented in api.md §9.
 *
 * These deliberately return a plain body (not the business error envelope): they are
 * infrastructure endpoints consumed by Docker healthchecks and the hosting platform.
 */
export function createHealthRouter(database?: Database): Router {
  const router = Router();

  /** Liveness — the process is up. No database call, so a database outage cannot restart us. */
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /**
   * Readiness — are dependencies reachable?
   * api.md §9: `200` if `SELECT 1` succeeds, else `503`.
   */
  router.get('/health/ready', async (_req, res) => {
    if (!database) {
      res.status(503).json({
        status: 'not_ready',
        checks: { database: 'disconnected' },
      });
      return;
    }

    try {
      await database.ping();
      res.status(200).json({
        status: 'ready',
        checks: { database: 'connected' },
      });
    } catch {
      res.status(503).json({
        status: 'not_ready',
        checks: { database: 'unreachable' },
      });
    }
  });

  return router;
}

