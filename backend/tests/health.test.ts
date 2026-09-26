import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/shared/logger.js';

// The app takes its dependencies, so tests never need a real environment (architecture.md §4).
const app = createApp({
  env: { CORS_ORIGIN: 'http://localhost:3000' },
  logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
});

describe('GET /api/v1/health (liveness)', () => {
  it('reports ok and echoes a request id', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  it('honestly reports not_ready until the database check exists (Phase 2)', async () => {
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.database).toBe('not_configured_until_phase_2');
  });
});

describe('unknown routes', () => {
  it('answers with the documented error envelope, not HTML', async () => {
    const response = await request(app).get('/api/v1/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
});
