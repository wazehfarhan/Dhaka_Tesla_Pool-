import type { Role } from './types';

/** Where each role belongs after signing in, and which role owns a path. */
export function homePathFor(role: Role): string {
  return role === 'DRIVER' ? '/driver' : '/passenger';
}

/** `/login?next=/passenger/rides` — the guard remembers where the user was headed. */
export function loginPathFor(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

/**
 * Role ownership of a route, or `null` for shared/guest routes. Used by the
 * client guard *and* by `middleware.ts` (both are convenience; the API decides).
 */
export function roleForPath(pathname: string): Role | null {
  if (pathname === '/passenger' || pathname.startsWith('/passenger/')) return 'PASSENGER';
  if (pathname === '/driver' || pathname.startsWith('/driver/')) return 'DRIVER';
  return null;
}

/** Only same-origin relative paths are accepted for `?next=` (no open redirects). */
export function safeNextPath(next: string | null, fallback: string): string {
  if (next === null || next === '') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
