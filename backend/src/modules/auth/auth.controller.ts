import { parse } from 'cookie';
import type { CookieOptions, Request, RequestHandler } from 'express';
import type { Env } from '../../config/env.js';
import { ForbiddenError, UnauthenticatedError } from '../../shared/errors.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

/**
 * Controllers — architecture.md §3: parse with Zod, call exactly one service
 * method, map the result to a status code. Rejected promises flow straight to
 * the error middleware (Express 5), which owns the `{success:false}` envelope.
 */
export interface AuthControllerDependencies {
  service: AuthService;
  env: Pick<Env, 'CORS_ORIGIN' | 'NODE_ENV'> & Partial<Pick<Env, 'COOKIE_SAMESITE'>>;
}

/**
 * Cookie flags from security.md §1: httpOnly, SameSite, Secure in production,
 * scoped path. `COOKIE_SAMESITE=none` is the split-domain production mode
 * (Vercel web → Render API): browsers only accept `SameSite=None` with
 * `Secure`, so Secure is forced there regardless of NODE_ENV.
 */
function refreshCookieOptions(
  env: Partial<Pick<Env, 'NODE_ENV' | 'COOKIE_SAMESITE'>> & Pick<Env, 'NODE_ENV'>,
): CookieOptions {
  const crossSite = env.COOKIE_SAMESITE === 'none';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: env.NODE_ENV === 'production' || crossSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[REFRESH_COOKIE_NAME];
}

/**
 * CSRF defence for the two cookie-authenticated endpoints (security.md §1):
 * refresh and logout are POSTs protected by SameSite=Lax *and* this Origin
 * check. Browsers always send Origin on cross-site POSTs; non-browser clients
 * (curl, tests) send none, which is safe — they hold the cookie deliberately.
 */
function assertTrustedOrigin(req: Request, env: Pick<Env, 'CORS_ORIGIN'>): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const allowed = env.CORS_ORIGIN.split(',').map((value) => value.trim());
  if (!allowed.includes(origin)) throw new ForbiddenError('Origin is not allowed.');
}

export function createAuthController({ service, env }: AuthControllerDependencies): {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
} {
  const register: RequestHandler = async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await service.register(input);
    res.status(201).json({ success: true, data: user });
  };

  const login: RequestHandler = async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken } = await service.login(input);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(env));
    res.status(200).json({ success: true, data: { user, accessToken } });
  };

  const refresh: RequestHandler = async (req, res) => {
    assertTrustedOrigin(req, env);
    const { accessToken, refreshToken } = await service.refresh(readRefreshCookie(req));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(env));
    res.status(200).json({ success: true, data: { accessToken } });
  };

  const logout: RequestHandler = async (req, res) => {
    assertTrustedOrigin(req, env);
    await service.logout(readRefreshCookie(req));
    // Clearing requires the same flags the cookie was set with, minus maxAge
    // (an explicit maxAge would win over the epoch expiry and keep it alive).
    const { maxAge: _maxAge, ...clearOptions } = refreshCookieOptions(env);
    res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
    res.status(204).end();
  };

  const me: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError(); // authenticate runs first; belt and braces
    const user = await service.getMe(req.user.id);
    res.status(200).json({ success: true, data: user });
  };

  return { register, login, refresh, logout, me };
}
