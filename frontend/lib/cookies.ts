/**
 * The one readable cookie the app sets, and the reason it is safe.
 *
 * ui-ux §2 and security.md §4: "Middleware (Next.js) enforces role access: a
 * passenger hitting `/driver/*` is redirected … the UI check is convenience, not
 * security". Next middleware runs before React (and therefore before the
 * in-memory token exists), so it needs *something* readable to route on — hence
 * this cookie. It holds a role name and nothing else: no token, no PII, no
 * authority. The API re-authorises every request regardless, so tampering with it
 * only produces a redirect the user can undo.
 */

import type { Role } from './types';

export const ROLE_COOKIE = 'dtp_role';

/**
 * `dtp_session` — a "there might be a session here" flag, and the reason the app
 * does not call `POST /auth/refresh` on every anonymous page view.
 *
 * The refresh token itself is `httpOnly` and unreadable by design (security.md
 * §1), so the client cannot know whether one exists. Without this flag the app
 * had to *guess* by asking the API, which meant every guest landing on `/login`
 * fired a doomed refresh and the browser console showed a `401`/`429` for a
 * request nobody needed. The flag carries no token, no PII and no authority: it
 * only says "try the cookie". A stale or forged value costs one request and
 * changes nothing — the API still decides.
 */
export const SESSION_COOKIE = 'dtp_session';

export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
}

export function setSessionHint(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=604800; samesite=lax`;
}

export function clearSessionHint(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function setRoleCookie(role: Role): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ROLE_COOKIE}=${role}; path=/; max-age=604800; samesite=lax`;
}

export function clearRoleCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
