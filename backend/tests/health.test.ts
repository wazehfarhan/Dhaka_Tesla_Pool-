import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { createLogger } from '../src/shared/logger.js';

// The app takes its dependencies, so tests never need a real environment (architecture.md §4).
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });
const baseEnv = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

describe('GET /api/v1/health (liveness)', () => {
  it('reports ok and echoes a request id', async () => {
    const app = createApp({ env: baseEnv, logger });
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  it('reports 503 not_ready when no database is configured', async () => {
    const app = createApp({ env: baseEnv, logger });
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.database).toBe('disconnected');
  });

  it('reports 200 ready when database ping succeeds', async () => {
    const mockDb: Database = {
      prisma: {} as any,
      ping: async () => {},
      close: async () => {},
    };
    const app = createApp({ env: baseEnv, logger, database: mockDb });
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database).toBe('connected');
  });

  it('reports 503 not_ready when database ping throws', async () => {
    const failingDb: Database = {
      prisma: {} as any,
      ping: async () => {
        throw new Error('Connection refused');
      },
      close: async () => {},
    };
    const app = createApp({ env: baseEnv, logger, database: failingDb });
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.database).toBe('unreachable');
  });
});

describe('unknown routes', () => {
  it('answers with the documented error envelope, not HTML', async () => {
    const app = createApp({ env: baseEnv, logger });
    const response = await request(app).get('/api/v1/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
});
