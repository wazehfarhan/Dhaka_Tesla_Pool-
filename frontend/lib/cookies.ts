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

export function setRoleCookie(role: Role): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ROLE_COOKIE}=${role}; path=/; max-age=604800; samesite=lax`;
}

export function clearRoleCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
