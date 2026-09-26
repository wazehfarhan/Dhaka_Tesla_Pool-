import { Router } from 'express';

/**
 * Probes documented in api.md §9.
 *
 * These deliberately return a plain body (not the business error envelope): they are
 * infrastructure endpoints consumed by Docker healthchecks and the hosting platform.
 */
export function createHealthRouter(): Router {
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
   * The `SELECT 1` database check is wired up in Phase 2 (todo.md). Until then this reports
   * the truth (503 / not ready) rather than pretending to be healthy.
   */
  router.get('/health/ready', (_req, res) => {
    res.status(503).json({
      status: 'not_ready',
      checks: { database: 'not_configured_until_phase_2' },
    });
  });

  return router;
}
