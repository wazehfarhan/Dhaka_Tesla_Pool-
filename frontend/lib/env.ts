/**
 * One place where the browser learns where the API lives (api.md §1 — everything
 * is mounted under `/api/v1`).
 *
 * On Vercel the frontend and API share one origin (vercel.json rewrites
 * `/api/*` to the Express function), so the same-origin default (relative
 * `/api/v1`) is right and no CORS preflight happens. `NEXT_PUBLIC_API_URL` is
 * only needed for split deployments (local compose, Render): it is inlined at
 * build time by Next and must be the bare origin (`http://localhost:4000`, no
 * trailing slash, no `/api` suffix). Unset in local `next dev` means
 * same-origin too — point it at the API when the two run on different ports.
 */
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * Absolute origin in split deployments (`http://localhost:4000` in compose),
 * empty on Vercel where frontend and API share one origin — so `API_BASE` is
 * the relative `/api/v1` there and no CORS preflight happens. In local
 * `next dev` set `NEXT_PUBLIC_API_URL=http://localhost:4000` (via root `.env`)
 * because web (:3000) and API (:4000) run on different ports.
 */
export const API_URL = API_ORIGIN;

/** Every request path in `lib/api.ts` is relative to this. */
export const API_BASE = `${API_URL}/api/v1`;

/**
 * Show the demo-cast buttons on `/login`?
 *
 * They are only truthful when the seeded accounts exist, which is the API's
 * `SEED_DEMO_USERS` decision (backend/prisma/seed.ts). Compose sets both flags
 * together; a real deployment sets neither, so the page never offers a login
 * that is guaranteed to fail.
 */
export const DEMO_ACCOUNTS_ENABLED = ['1', 'true'].includes(
  process.env.NEXT_PUBLIC_DEMO_ACCOUNTS ?? '',
);
