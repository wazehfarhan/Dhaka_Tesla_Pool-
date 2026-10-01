/**
 * One place where the browser learns where the API lives (api.md §1 — everything
 * is mounted under `/api/v1`).
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time by Next; the localhost fallback
 * keeps `npm run dev:web` working on a fresh clone where no `frontend/.env.local`
 * exists yet (the root `.env.example` documents the variable).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
