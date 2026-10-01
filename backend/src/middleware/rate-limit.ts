import { rateLimit } from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../shared/errors.js';

/** security.md §5: 100 req/min/IP general, 10 req/min on /auth/login|register. */
const WINDOW_MS = 60_000;
const GENERAL_LIMIT = 100;
const AUTH_LIMIT = 10;
/**
 * `POST /auth/refresh` gets its own bucket instead of sharing the credential one.
 *
 * It is not a credential attack surface — there is no password to guess, only an
 * `httpOnly` cookie the browser sends automatically — and it is called by the app
 * itself on **every page load** (silent session restore). Sharing the 10/min
 * credential bucket meant that opening a few tabs could throttle the very next
 * sign-in, which is indistinguishable from a brute-force lockout to the user.
 * 30/min is generous for reloads and still bounded.
 */
const REFRESH_LIMIT = 30;

/**
 * Optional overrides for the two ceilings.
 *
 * The defaults are the documented production values, and the limiters themselves
 * are never skipped: this is a *tuning* knob (an operator may want different
 * numbers), not a test-only bypass. The concurrency suite is the reason it
 * exists — it fires 200+ requests in a few seconds on purpose, and being
 * throttled by our own rate limiter would look exactly like a lost race
 * (todo.md Phase 9, "zero tolerance for flakes").
 */
export interface RateLimitOverrides {
  general?: number;
  auth?: number;
  refresh?: number;
}

/** Every rejection answers in the documented envelope (api.md §1), not plain text. */
function rejectionHandler(_req: Request, res: Response, _next: NextFunction): void {
  const error = new AppError('RATE_LIMITED', 'Too many requests. Please try again shortly.');
  // RFC 6585 companion header: seconds until the window resets (security.md §5).
  res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
  res.status(error.status).json(error.toEnvelope());
}

export interface RateLimiters {
  general: RequestHandler;
  auth: RequestHandler;
  refresh: RequestHandler;
}

/**
 * Factories return fresh limiters with their own in-memory store, so counters
 * are per-app-instance. Single-instance memory is acceptable for the MVP
 * (security.md §5); the scale-up path is a shared store.
 */
export function createRateLimiters(overrides: RateLimitOverrides = {}): RateLimiters {
  const make = (limit: number) =>
    rateLimit({
      windowMs: WINDOW_MS,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rejectionHandler,
    });

  return {
    general: make(overrides.general ?? GENERAL_LIMIT),
    auth: make(overrides.auth ?? AUTH_LIMIT),
    refresh: make(overrides.refresh ?? REFRESH_LIMIT),
  };
}
