# Security Design — Dhaka Tesla Pool (MVP)

Companion documents: [requirements](requirements.md) · [api](api.md) · [database](database.md) · [testing](testing.md) · [traceability](traceability.md)

Practical MVP security: enough to honestly defend the brief's auth/authz and data-integrity requirements, with no security theatre and no paid services.

## 1. Authentication

**Password handling.** bcrypt with cost factor ≥ 12, hash stored in `users.password_hash` (never logged, never serialized). Login compares via bcrypt (`INVALID_CREDENTIALS` identical for unknown email and wrong password — no user enumeration). Minimum 8 chars enforced at the Zod edge.

**Token strategy (two tokens):**

| Token | Lifetime | Storage | Why |
|---|---|---|---|
| Access JWT (`sub`, `role`, `iat`, `exp`) | 15 min | **In frontend memory only** (React state) | Not readable via `document.cookie`/localStorage → XSS cannot exfiltrate it |
| Refresh JWT (`sub`, `jti`, `exp`) | 7 days | `httpOnly; SameSite=Lax; Secure` cookie, path `/api/v1/auth` | Survives page reloads; inaccessible to JS; rotation invalidates stolen-old tokens |

- **Login:** `POST /auth/login` → body carries access token, cookie carries refresh token.
- **Refresh:** on `401`, the frontend calls `POST /auth/refresh` → new access token. The refresh `jti` **rotates**: the presented token's row in `refresh_tokens` is marked rotated/revoked and a new row is issued, so a replayed old token is rejected server-side.
- **Logout:** `POST /auth/logout` clears the cookie **and** revokes the token's row (`revoked_at`), so a captured cookie cannot be reused.
- **Revocation store:** `refresh_tokens(user_id, jti_hash, expires_at, revoked_at, rotated_at)` — the *only* stateful part of auth; access tokens remain stateless (database §3.6). Expired rows are swept periodically; at multiple API instances this table (or a shared store) remains the single source of truth for revocation ([architecture §9](architecture.md)).
- **CSRF:** refresh/logout are the only cookie-authenticated endpoints; both are `POST` + `SameSite=Lax` + server-side `Origin` check. All business endpoints use the `Authorization` header (not cookies) → CSRF-immune by construction.
- **JWT secrets:** two independent random strings (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) from environment; boot fails if missing/too short (Zod env schema).

## 2. Authorization

Roles are an enum on `users` (`PASSENGER`, `DRIVER`); the JWT carries `role`; route middleware declares required roles.

| Action | PASSENGER | DRIVER |
|---|---|---|
| Request/list/view/pay/cancel **own** ride | ✅ | ❌ `403` |
| View another passenger's ride | ❌ `404` | own pools only |
| View open pools, accept/arrive/start/complete | ❌ `403` | ✅ pools of own vehicle |
| Toggle own vehicle online/offline | ❌ `403` | ✅ |
| Simulate payment for own completed ride | ✅ | ❌ |

**Resource ownership** is enforced *inside service queries* — every fetch is scoped (`where: { id, passengerId: req.user.id }` for rides; `where: { id, driverId: req.user.id }` for pools). A ride that exists but belongs to someone else returns `404 NOT_FOUND` (not `403`) so attackers cannot probe valid IDs ([api.md](api.md) §1). Role failures on *endpoint classes* (passenger → `/driver/*`) do return `403`, because the path itself reveals nothing.

**The brief's explicit rule — "Passenger A cannot modify Passenger B's ride"** — is therefore enforced twice: wrong role → `403`, right role + foreign resource → `404`, and it is directly tested ([testing.md](testing.md) §5).

## 3. Input validation

All user-controlled input passes Zod schemas at the controller edge; nothing reaches a service unvalidated:

| Input | Rules |
|---|---|
| Pickup / destination | must exist in `zones`, must differ (`SAME_ZONE`, `ZONE_NOT_FOUND`) |
| Seats | integer, 1…vehicle `seat_capacity` |
| IDs in paths | UUID format → malformed is `400`, well-formed foreign ID is `404` |
| Status transitions | never client-supplied — only service methods change status, each verifying the current status (`ILLEGAL_STATE_TRANSITION`) |
| Fare/payment fields | clients can never send amounts; the server computes and persists every `_poisha` value |
| Email / password / name | format + length + normalization (email lowercased, trimmed) |

## 4. Database security

- **Parameterized access only:** all queries go through Prisma (parameterized), or `$queryRaw`/`$executeRaw` with **bound `$1,$2…` parameters** — no string concatenation SQL anywhere.
- **Constraints as a second lock:** `CHECK (seats_taken <= seat_capacity)`, partial unique indexes (one active membership per request, one `OPEN` pool per corridor), FK `ON DELETE RESTRICT` — even a buggy service call cannot persist an overbooked or doubly-attached row ([database.md](database.md) §9).
- **Transactions:** every multi-row operation (join pool, cancel, complete, pay) runs in one transaction; partial writes roll back.
- **Least privilege:** the app connects with a role limited to its own schema (no superuser); Compose grants only the app role rights on its database/schema.
- **Secrets:** `DATABASE_URL`, JWT secrets live in environment variables only — never in code, never in git.

## 5. API security

- **Rate limiting:** `express-rate-limit` — 100 req/min/IP general, 10 req/min on `/auth/*` → `429 RATE_LIMITED` + `Retry-After`. In-memory store is acceptable for a single instance (scale-up path: shared store — [architecture.md](architecture.md) §9).
- **CORS:** explicit allowlist (`CORS_ORIGIN` = frontend origin only), credentials enabled for the refresh cookie; never `*` with credentials.
- **Security headers:** `helmet` defaults (CSP, `X-Content-Type-Options`, referrer policy); HSTS delegated to the hosting platform.
- **Error handling:** single error middleware; unknown errors return generic `INTERNAL` with a logged request id — stack traces, SQL, and env values never reach the client.
- **Body limits:** `express.json({ limit: '100kb' })`.
- **Pipeline order:** CORS → helmet → rate limit → body parse → `authenticate` (JWT) → `authorize(role)` → controller → error handler.

## 6. Secrets and `.env`

Never committed: `.env`, `.env.*` (except `.env.example`), JWT secrets, database passwords, API keys. `.gitignore` covers them; the review checklist greps for accidental commits.

`.env.example` (documented here; file created in Phase 1 of [todo.md](../todo.md)):

```bash
# --- Postgres ---
DATABASE_URL=postgresql://app:app_password@localhost:5432/dhaka_tesla_pool
# --- API ---
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
JWT_ACCESS_SECRET=dev_access_secret_please_change_me_32chars
JWT_REFRESH_SECRET=dev_refresh_secret_please_change_me_32chars
# --- Tests (separate DB for integration/concurrency suites) ---
DATABASE_URL_TEST=postgresql://app:app_password@localhost:5433/dhaka_tesla_pool_test
# --- Frontend ---
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## 7. Threat recap (what we defend, and how)

| Threat | Defence | Test |
|---|---|---|
| Overbook Bullet under race | atomic conditional `UPDATE` + `CHECK` | concurrency test |
| Passenger edits another's ride | ownership-scoped queries → `404` | authz integration tests |
| Invalid state jump (start before accept) | service state machine + conditional update | transition unit tests |
| Fare tampering | client never sends money fields | validation tests |
| Token theft via XSS | access token in memory, refresh `httpOnly` | review checklist |
| User enumeration | uniform `401 INVALID_CREDENTIALS` | auth integration test |
| SQL injection | Prisma / bound parameters only | no raw-concatenation grep in review |
| Brute force | rate limiting on `/auth/*` | rate-limit test |