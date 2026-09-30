/**
 * Auth protocol constants — security.md §1 and api.md §2 in one place, so the
 * token service, the controllers and the tests all agree on the wire format.
 */

/** Cookie name for the refresh token (api.md §2: `Set-Cookie: refresh=…`). */
export const REFRESH_COOKIE_NAME = 'refresh';

/** Scoped to the auth endpoints so the cookie is never sent to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Access tokens: 15 minutes, held in frontend memory only (security.md §1). */
export const ACCESS_TOKEN_TTL = '15m';

/** Refresh tokens: 7 days — JWT expiry, cookie Max-Age and DB row `expiresAt` all match. */
export const REFRESH_TOKEN_TTL = '7d';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

/** bcrypt cost factor — security.md §1 mandates ≥ 12. */
export const BCRYPT_COST = 12;
