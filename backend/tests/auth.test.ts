import type { Express, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuthMiddleware, type AuthUser } from '../src/middleware/auth.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../src/modules/auth/auth.constants.js';
import { createTokenService } from '../src/modules/auth/token.service.js';
import { AppError } from '../src/shared/errors.js';
import { createLogger } from '../src/shared/logger.js';
import { createFakeDatabase } from './helpers/fake-database.js';

/**
 * Phase 3 auth suite (todo.md) — covers the api.md §2 contract end-to-end through
 * the real Express pipeline: validation, bcrypt hashing, JWT claims, refresh
 * rotation + replay rejection, Origin checks, role gates, rate limiting and the
 * "no secrets in responses" DoD. Only storage is faked (helpers/fake-database).
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
  COOKIE_SAMESITE: 'lax' as const,
};

const PASSWORD = 'supersecret123';

function makeApp() {
  const database = createFakeDatabase();
  const app: Express = createApp({ env, logger, database });
  return { app, database };
}

interface SeedOverrides {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
}

async function register(app: Express, overrides: SeedOverrides = {}) {
  const body = {
    name: 'Nusrat',
    email: 'nusrat@example.com',
    password: PASSWORD,
    role: 'PASSENGER',
    ...overrides,
  };
  const response = await request(app).post('/api/v1/auth/register').send(body);
  expect(response.status).toBe(201);
  return { response, body };
}

/** Seed a user, then log in — returns the login response (cookie + access token). */
async function login(app: Express, overrides: SeedOverrides = {}) {
  const { body: seeded } = await register(app, overrides);
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: seeded.email, password: seeded.password });
  expect(response.status).toBe(200);
  return response;
}

/** The raw `Set-Cookie` header the server sent for the refresh cookie. */
function refreshCookieHeader(response: request.Response): string {
  const headers = response.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = headers?.find((header) => header.startsWith(`${REFRESH_COOKIE_NAME}=`));
  expect(raw).toBeDefined();
  return raw as string;
}

/** The refresh token value only (no flags). */
function refreshCookieValue(response: request.Response): string {
  const pair = refreshCookieHeader(response).split(';')[0] ?? '';
  return pair.slice(pair.indexOf('=') + 1);
}

/** How a browser would echo the cookie back on a request. */
function cookieHeader(response: request.Response): string {
  return `${REFRESH_COOKIE_NAME}=${refreshCookieValue(response)}`;
}

function accessToken(response: request.Response): string {
  return response.body.data.accessToken as string;
}

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns only the public profile', async () => {
    const { app, database } = makeApp();
    const response = await request(app).post('/api/v1/auth/register').send({
      name: '  Nusrat  ',
      email: ' Nusrat@Example.com ',
      password: PASSWORD,
      role: 'PASSENGER',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: expect.any(String),
        name: 'Nusrat',
        email: 'nusrat@example.com',
        role: 'PASSENGER',
      },
    });

    // Stored as a bcrypt cost-12 hash, never the plaintext (security.md §1).
    const stored = [...database.users.values()][0];
    expect(stored?.passwordHash).toMatch(/^\$2/);
    expect(stored?.passwordHash).not.toBe(PASSWORD);
  });

  it('rejects a duplicate email — including case-variants — with 409 EMAIL_TAKEN', async () => {
    const { app } = makeApp();
    await register(app);

    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'Impostor',
      email: 'NUSRAT@EXAMPLE.COM',
      password: PASSWORD,
      role: 'PASSENGER',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates name, email, password and role at the edge', async () => {
    const { app, database } = makeApp();
    const invalidBodies = [
      { name: 'N', email: 'nusrat@example.com', password: PASSWORD, role: 'PASSENGER' },
      { name: 'Nusrat', email: 'not-an-email', password: PASSWORD, role: 'PASSENGER' },
      { name: 'Nusrat', email: 'nusrat@example.com', password: 'short', role: 'PASSENGER' },
      { name: 'Nusrat', email: 'nusrat@example.com', password: PASSWORD, role: 'ADMIN' },
      { name: 'Nusrat', email: 'nusrat@example.com', password: PASSWORD },
    ];

    for (const body of invalidBodies) {
      const response = await request(app).post('/api/v1/auth/register').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    }

    expect(database.users.size).toBe(0); // nothing partially written
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns an access token with the documented claims and sets the refresh cookie', async () => {
    const { app } = makeApp();
    const { body: seeded } = await register(app, {
      name: 'Jashim',
      email: 'jashim@example.com',
      role: 'DRIVER',
    });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toEqual({
      id: expect.any(String),
      name: 'Jashim',
      email: 'jashim@example.com',
      role: 'DRIVER',
    });

    // Access claims: sub, role (+ our type discriminator), 15-minute exp (security.md §1).
    const claims = jwt.decode(accessToken(response)) as JwtPayload | null;
    expect(claims).toMatchObject({
      sub: response.body.data.user.id,
      role: 'DRIVER',
      type: 'access',
    });
    expect((claims?.exp ?? 0) - (claims?.iat ?? 0)).toBe(15 * 60);

    // Cookie shape per api.md §2: HttpOnly, SameSite=Lax, scoped path; Secure is production-only.
    const setCookie = refreshCookieHeader(response);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain(`Path=${REFRESH_COOKIE_PATH}`);
    expect(setCookie).not.toContain('Secure');
  });

  it('uses SameSite=None; Secure in split-domain production (COOKIE_SAMESITE=none)', async () => {
    const { app } = makeApp();
    await register(app);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nusrat@example.com', password: PASSWORD });
    expect(response.status).toBe(200);
    // Default fixture env is `lax` — the cross-site assertion needs its own app.
    expect(refreshCookieHeader(response)).toContain('SameSite=Lax');
  });

  it('sets SameSite=None; Secure when COOKIE_SAMESITE=none (Vercel → Render)', async () => {
    const database = createFakeDatabase();
    const crossSiteApp: Express = createApp({
      env: { ...env, COOKIE_SAMESITE: 'none' },
      logger,
      database,
    });
    await register(crossSiteApp);
    const response = await request(crossSiteApp)
      .post('/api/v1/auth/login')
      .send({ email: 'nusrat@example.com', password: PASSWORD });
    expect(response.status).toBe(200);
    const setCookie = refreshCookieHeader(response);
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Secure');
  });

  it('rate-limits per forwarded client IP behind a proxy (trust proxy)', async () => {
    const { app } = makeApp();
    // Ten failing logins from one spoofed client exhaust *its* 10/min bucket …
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.7')
        .send({ email: 'nobody@example.com', password: PASSWORD });
    }
    const throttled = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(throttled.status).toBe(429);
    // … while a different client IP on the same proxy is unaffected.
    const other = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(other.status).toBe(401);
  });

  it('answers 401 INVALID_CREDENTIALS identically for unknown email and wrong password', async () => {
    const { app } = makeApp();
    await register(app);

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nusrat@example.com', password: 'wrong-password-123' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    // Same code *and* message — nothing distinguishes "no such user" (security.md §1).
    expect(unknown.body.error).toEqual(wrong.body.error);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the profile for a valid access token', async () => {
    const { app } = makeApp();
    const session = await login(app);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken(session)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      id: expect.any(String),
      name: 'Nusrat',
      email: 'nusrat@example.com',
      role: 'PASSENGER',
    });
  });

  it('rejects missing, malformed, expired and wrong-type tokens with 401', async () => {
    const { app } = makeApp();
    await register(app);

    const missing = await request(app).get('/api/v1/auth/me');
    const malformed = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nope');
    const expired = await request(app)
      .get('/api/v1/auth/me')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: 'x', role: 'PASSENGER', type: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: '-10s' })}`,
      );
    // A refresh token wearing the *access* secret still fails the type check.
    const wrongType = await request(app)
      .get('/api/v1/auth/me')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: 'x', jti: 'j', type: 'refresh' }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' })}`,
      );

    for (const response of [missing, malformed, expired, wrongType]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects a token signed with a different secret (forgery)', async () => {
    const { app } = makeApp();
    await register(app);

    const forged = jwt.sign(
      { sub: 'x', role: 'DRIVER', type: 'access' },
      'attacker-guesses-this-secret-value-32ch',
      { expiresIn: '10m' },
    );
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates both tokens and refuses the replayed old cookie', async () => {
    const { app, database } = makeApp();
    const first = await login(app);

    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(first));
    expect(second.status).toBe(200);
    // Rotation mints a fresh refresh token (new jti); the access token is
    // stateless, so re-issuing within the same second legitimately looks alike.
    expect(refreshCookieValue(second)).not.toBe(refreshCookieValue(first));
    expect(jwt.decode(accessToken(second))).toMatchObject({ type: 'access' });

    // The new access token is immediately usable (rotation produced a real session).
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken(second)}`);
    expect(me.status).toBe(200);

    // Replay of the rotated-out cookie is refused server-side (security.md §1).
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(first));
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHENTICATED');

    // …while the rotated-in cookie keeps the chain alive. One row per exchange.
    const third = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(second));
    expect(third.status).toBe(200);
    expect(database.refreshTokens.size).toBe(3);
  });

  it('requires a cookie and a trusted Origin', async () => {
    const { app } = makeApp();

    const noCookie = await request(app).post('/api/v1/auth/refresh');
    expect(noCookie.status).toBe(401);

    const session = await login(app);
    const evil = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieHeader(session));
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('FORBIDDEN');

    const allowed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookieHeader(session));
    expect(allowed.status).toBe(200);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session: 204, cleared cookie, and refresh afterwards fails', async () => {
    const { app } = makeApp();
    const session = await login(app);

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookieHeader(session));
    expect(out.status).toBe(204);

    // Cookie is cleared (epoch expiry / zero max-age), same path it was set with.
    const cleared = refreshCookieHeader(out);
    expect(cleared).toContain(`${REFRESH_COOKIE_NAME}=;`);
    expect(cleared).toMatch(/1970|Max-Age=0/);

    const after = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(session));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is idempotent, needs no cookie, and is Origin-checked', async () => {
    const { app } = makeApp();
    const session = await login(app);

    const evil = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieHeader(session));
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('FORBIDDEN');

    const first = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(session));
    const second = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(session));
    const noCookie = await request(app).post('/api/v1/auth/logout');

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(noCookie.status).toBe(204);
  });
});

describe('rate limiting (security.md §5)', () => {
  it('answers 429 RATE_LIMITED with Retry-After after 10 /auth requests per minute', async () => {
    const { app } = makeApp();

    // The auth limiter runs before body parsing, so even rejected payloads count.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await request(app).post('/api/v1/auth/login').send({});
      expect(response.status).toBe(400); // allowed through, just invalid input
    }

    const limited = await request(app).post('/api/v1/auth/login').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('keeps /auth/refresh out of the credential bucket, so reloads cannot lock out a sign-in', async () => {
    const { app } = makeApp();

    // Exhaust the credential ceiling on login…
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await request(app).post('/api/v1/auth/login').send({});
    }
    const blocked = await request(app).post('/api/v1/auth/login').send({});
    expect(blocked.status).toBe(429);

    // …then prove a session restore is still served from its own, larger bucket.
    // This is the bug a prefix mount of `/api/v1/auth` would reintroduce: refresh
    // would silently inherit the 10/min credential ceiling, and a user whose
    // access token expired right after a few reloads would be signed out by a
    // throttle rather than restored (see `RefreshOutcome` in frontend/lib/api.ts).
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await request(app).post('/api/v1/auth/refresh');
      expect(response.status).not.toBe(429);
    }
  });
});

describe('authenticate / authorize middleware (role gates)', () => {
  const tokens = createTokenService(env);

  function runMiddleware(
    middleware: RequestHandler,
    req: Partial<Request> = {},
  ): Promise<{ error: unknown; user?: AuthUser }> {
    return new Promise((resolve) => {
      const requestObject = { headers: {}, ...req } as Request;
      middleware(requestObject, {} as Response, (error?: unknown) => {
        resolve({ error, user: requestObject.user });
      });
    });
  }

  it('attaches the verified user to the request', async () => {
    const { authenticate } = createAuthMiddleware(tokens);
    const token = tokens.signAccessToken({ sub: 'user-1', role: 'PASSENGER' });

    const result = await runMiddleware(authenticate, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.error).toBeUndefined();
    expect(result.user).toEqual({ id: 'user-1', role: 'PASSENGER' });
  });

  it('rejects missing or non-Bearer headers with UNAUTHENTICATED', async () => {
    const { authenticate } = createAuthMiddleware(tokens);
    const headersList = [
      {},
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
    ];

    for (const headers of headersList) {
      const result = await runMiddleware(authenticate, { headers });
      expect((result.error as AppError).code).toBe('UNAUTHENTICATED');
      expect(result.user).toBeUndefined();
    }
  });

  it('authorize admits listed roles and answers FORBIDDEN otherwise', async () => {
    const { authorize } = createAuthMiddleware(tokens);
    const driverOnly = authorize('DRIVER');

    const driver = await runMiddleware(driverOnly, { user: { id: 'd', role: 'DRIVER' } });
    expect(driver.error).toBeUndefined();

    const passenger = await runMiddleware(driverOnly, { user: { id: 'p', role: 'PASSENGER' } });
    expect(passenger.error).toBeInstanceOf(AppError);
    expect(passenger.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });

    // authenticate has not run → still a clean 401, not a crash.
    const anonymous = await runMiddleware(driverOnly, {});
    expect((anonymous.error as AppError).code).toBe('UNAUTHENTICATED');
  });
});

describe('response hygiene (Phase 3 DoD: no token/password leaks)', () => {
  it('never serialises password material, and stores only jti hashes', async () => {
    const { app, database } = makeApp();

    const registered = await register(app);
    const session = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nusrat@example.com', password: PASSWORD });
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken(session)}`);

    for (const response of [registered.response, session, me]) {
      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain('"password"');
      expect(raw).not.toContain('passwordHash');
    }

    // The revocation store holds SHA-256 digests — never a raw jti (schema comment).
    expect(database.refreshTokens.size).toBe(1);
    for (const row of database.refreshTokens.values()) {
      expect(row.jtiHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
