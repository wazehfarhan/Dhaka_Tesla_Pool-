/**
 * The access token lives **in memory only** (api.md §1, security.md §1): no
 * `localStorage`, no readable cookie, so an XSS cannot read it back. The refresh
 * token stays in the backend's `httpOnly` cookie and is never touched by JS.
 *
 * A module-level store (not React state) because `apiFetch` needs the token
 * outside the React tree, and because a single-flight refresh must be visible to
 * every concurrent caller. Components subscribe through `AuthProvider`.
 */

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function subscribeToToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
