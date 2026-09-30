# Implementation Roadmap — Dhaka Tesla Pool (MVP)

Source of truth: [docs/](/) — especially [requirements.md](docs/requirements.md) and [traceability.md](docs/traceability.md). Do not start a phase before its dependencies are checked. Tasks are ordered by dependency, not by excitement.

> **Recommended build order note:** Phases 4–8 are logically separable but interdependent (e.g., `POST /rides` needs fare estimation and matching). If building strictly in sequence, implement in this order **7 → 6 → 4 → 5 → 8** while keeping the phase numbering below intact for traceability. Phase numbering follows the brief's structure.

Conventions: `<type>(<scope>): <description>` commits · every task = at least one commit · no code before its design doc section exists (it does — docs are complete).

---

## Phase 0 — Documentation ✅ (this stage)

- [x] Analyze brief → PRD, requirements, architecture, tech-stack, database, api, ui-ux, security, testing, deployment
- [x] Traceability matrix + gap analysis + assumptions ([docs/traceability.md](docs/traceability.md))
- [x] This roadmap with dependencies and Definitions of Done
- [ ] **Human review of the full documentation set** ← gate for everything below
- [ ] Apply reviewer corrections back into docs (never into code first)

**DoD:** reviewer approves docs; traceability has no unexplained "Missing" rows; all Open Decisions (D-01…D-06) closed.

## Phase 1 — Repository Setup _(deps: Phase 0)_ ✅

- [x] Branch layout: `main` (default, = the brief's `master` — D-03), `pre-release` created now, `release/v1.0.0` created at tagging (Phase 15); work happens on `feature/*` ([traceability §5](docs/traceability.md))
- [x] Root folder skeleton: `backend/`, `frontend/`, `docs/`, `todo.md` — npm workspaces, one `npm install`
- [x] Backend scaffold: Express 5 + strict TypeScript, ESLint 9 flat config + Prettier, Zod env validation (`config/env.ts`, boot fails loudly), rate card (`config/rate-card.ts`), typed errors (`shared/errors.ts`) + single error middleware, Pino logging with request ids, `GET /api/v1/health` (liveness) and `/api/v1/health/ready` (honestly `503` until Phase 2 wires the DB check)
- [x] Frontend scaffold: Next.js 16 (App Router) + TS + Tailwind 4 (CSS-first), boots on `:3000`, `/login` placeholder exists as the future compose healthcheck target
- [x] `.env.example` at the root (the exact vars from [security.md §6](docs/security.md), JWT secrets ≥ 32 chars) + `.gitignore` covering `.env*`, `node_modules/`, `dist/`, `.next/`, `next-env.d.ts`
- [x] `README.md` skeleton (cast, stack, quickstart, docs index, branch/commit conventions, AI-usage placeholder — filled in Phase 14)

**Phase 1 outcome (verified on Node 24 / npm 11):**

- `npm run typecheck` clean in both workspaces; `npm run lint` clean; `npm test` → **10/10 passing** (health envelope, error-contract registry, rate-card demo math)
- live boots: API `200` on `/api/v1/health` with `X-Request-Id` + helmet/CORS headers, `503` on `/health/ready`, `404` envelope on unknown routes; web `200` on `/` and `/login`
- pins recorded because the latest majors break the toolchain: **TypeScript 5.9.3** (`typescript-eslint@8` requires `< 6.1`) and **ESLint 9.39.5 repo-wide** (`eslint-config-next@16` plugins peer `≤ 9`) — `npm ls eslint` shows one deduped major
- carry-over: `/health/ready` performs `SELECT 1` in Phase 2; auth + rate-limiting middleware join the pipeline in Phase 3

**DoD met:** lint + typecheck pass in both packages; the API boots and answers the documented health/error contracts; no secrets or build output in git.

## Phase 2 — Database _(deps: 1)_ ✅

- [x] Prisma schema for all 10 tables per [database.md](docs/database.md) (types, enums, FKs, checks)
- [x] Partial unique indexes: one `OPEN` pool per vehicle+corridor; unique active membership per request
- [x] Migration `20260926193416_init` applied & committed with custom SQL constraints (corridor checks, capacity checks, positive distances, non-negative poisha amounts)
- [x] Idempotent seed: zones, 28 distances, story cast, Bullet (capacity 3)
- [x] `CHECK (seats_taken <= seat_capacity)` verified by deliberately failing raw SQL
- [x] Database readiness probe (`ping()` via `SELECT 1`) integrated into `GET /api/v1/health/ready`

**DoD:** `prisma migrate deploy` on empty DB creates everything; seed re-run twice changes nothing; ERD in docs matches actual schema.

## Phase 3 — Authentication _(deps: 2)_

- [x] `register` / `login` / `refresh` / `logout` / `me` per [api.md §2](docs/api.md)
- [x] bcrypt hashing, JWT issue/verify, refresh rotation, httpOnly cookie
- [x] `authenticate` + `authorize(role)` middleware, typed `req.user`
- [x] Unit + integration tests: auth happy path, duplicate email, bad credentials, refresh rotation, role gates

**DoD:** full auth integration suite green; no token/password leaks in responses or logs.

## Phase 4 — Passenger Flow (API) _(deps: 3; wiring needs 6 + 7 — see build-order note)_

- [x] Zones module: `GET /zones` + seed-backed distance lookup ([api §3](docs/api.md))
- [x] `POST /rides` endpoint: Zod validation, ownership/idempotency (`clientRequestId`), calls matching (Phase 6) + estimate (Phase 7) → `201` with `poolId` + estimate
- [x] `GET /rides` (list/history, pagination, status filter) + `GET /rides/:id` (detail with timeline, fare, payment) — ownership-scoped → `404` for foreign ids
- [x] Ride detail payload assembly from `ride_status_history`
- [x] Integration tests: create/list/detail happy paths + validation errors + foreign-id `404`

**DoD:** passenger endpoints match [api.md](docs/api.md) byte-for-byte in examples; authz tests (foreign ride → `404`) green. ✅ — `ride-create.test.ts` (23 tests) drives every documented path end-to-end: the demo request (Banani → Dhanmondi: `14400 → 2880 → 11520`), Rafiq joining Nusrat's pool (same `poolId`, 2/3 seats), a second corridor getting its own pool, `clientRequestId` replay (`200`, nothing written), the strict-body `400`s (`VALIDATION_ERROR` on an unknown key, `SAME_ZONE`, `ZONE_NOT_FOUND`), all three `409`s (`NO_VEHICLE_AVAILABLE` / `POOL_CAPACITY_EXCEEDED` / `ACTIVE_RIDE_EXISTS`), the 401/403 authz matrix, list pagination + `?status=` filtering, and detail assembly (pool summary, timeline, fare, payment). Suite **105/105**; live smoke against Docker Postgres reproduced the same payloads and ended with `seats_taken = Σ ACTIVE memberships = 2`. Design notes: `createRide` persists the fare estimate **and** the creation trail (`RIDE_REQUEST → REQUESTED`, plus `POOL → OPEN` when it created the pool) through matching's `persist` hook, so claim + ride + member + fare + history commit in one transaction (`MatchOutcome` gained `createdAt` for the response); an unknown `?status=` value is an honest empty page rather than a `400`; list rows carry fare + payment status (FR-HISTORY-001) via a single joined query.

## Phase 5 — Driver Flow (API) _(deps: 3, 4)_

- [ ] Vehicles: `GET/POST /vehicles`, `PATCH /vehicles/:id` (online toggle, owner-only)
- [ ] `GET /driver/pools` (status filter incl. `OPEN` queue + `COMPLETED` history) + `GET /driver/pools/:id` (roster + fares)
- [ ] `POST /driver/pools/:id/accept|arrive|start|complete` — conditional transitions + cascade to active members + status history, one transaction each
- [ ] Integration tests: progression happy path, out-of-order `409`s, passenger → `403`, foreign pool → `404`

**DoD:** full trip progression drivable via API tests alone (no UI yet); every transition writes history rows.

## Phase 6 — Pooling _(deps: 2, 4 endpoint shell)_ — executed second per the build-order note (7 → 6 → 4 → 5 → 8)

- [x] `matching.service`: five join conditions ([PRD §11](docs/PRD.md)) → join existing or create new `OPEN` pool
- [x] Atomic seat claim (raw conditional `UPDATE` in `$transaction`) + `POOL_CAPACITY_EXCEEDED` on 0 rows
- [x] Unique-violation retry path (racing creators converge on one pool)
- [x] Partial unique indexes active in migration (verify by attempting violations in tests)
- [x] Tests: shared corridor → one pool; different corridor → two pools; full pool → `409`; duplicate active membership impossible

**DoD:** `rideCreate.test` + `matching.test.ts` green; DB-level violations proven by direct SQL attempts. ✅ (per build order) — `matching.test.ts` (23 tests: pure decision table, pool formation, racing-creator retry, claim-race rollback, membership/idempotency guards, static migration assertions) + `capacity.test.ts` (5 boundary tests) green; suite **82/82**. _Carry-over:_ `rideCreate.test` landed with Phase 4's endpoint shell (`tests/ride-create.test.ts` — pool formation through the real HTTP stack; suite 105/105 after Phase 4), while the direct-SQL violation attempts await Phase 9 (the CHECK half is already Phase 9's bullet; Postgres is up locally). Design note: the unique-violation retry restarts the whole transaction — a failed INSERT aborts a Postgres transaction, so the catch lives outside `$transaction` (architecture §6 step 4, PG-correct reading).

## Phase 7 — Fare _(deps: 2, 6)_ — executed first per the build-order note (7 → 6 → 4 → 5 → 8)

- [x] `config/rate-card.ts` constants (6000 / 1200 / 20 / 5000 — landed in Phase 1) + pure `fare.service` (estimate + finalize, integer-poisha floor maths)
- [x] `POST /fare/estimate` endpoint (authenticated PASSENGER, strict body — clients can never submit amounts, `seatCapacity` + `poolAvailableSeats` per D-07)
- [ ] `fares` row lifecycle: `ESTIMATED` at create → `FINAL` at pool completion (discount iff ≥ 2 active completers; `perSeat × seats`) — _`saveEstimate` is wired into `POST /rides` (Phase 4 ✅, inside the matching transaction); `finalizeRideFare` closes with Phase 5's pool completion, at which point this box closes_
- [x] Unit tests: the worked example (`14400 → 2880 → 11520`), solo = no discount, floor rounding, min-fare guard, seats multiplier

**DoD:** `fare.test.ts` proves hand-calculated demo values byte-for-byte; no float in the money path (grep-verified). ✅ — suite 54/54 green; grep finds no float API and no decimal values in executable fare code (only taka figures inside comments, mirroring PRD §12.3).

## Phase 8 — Cancellation _(deps: 4, 5, 6, 7)_

- [ ] `POST /rides/:id/cancel`: pre-start only, frees seats atomically, membership → `CANCELLED`, empty pool → `CANCELLED`
- [ ] Driver pool cancel (pre-start) cascading to active members
- [ ] Status-history reasons (`PASSENGER_CANCELLED`, `DRIVER_CANCELLED`, `POOL_EMPTY`)
- [ ] Tests: seat accounting after mixed cancel/join, post-start `409`, others unaffected, pool-empty cascade

**DoD:** invariant `seats_taken = Σ ACTIVE memberships` holds after every test scenario (asserted directly in SQL).

## Phase 9 — Concurrency _(deps: 6, 8)_

- [ ] `lastSeat.race.test.ts` exactly as [testing §6](docs/testing.md) (1 seat free → Nusrat vs Shirin → one `201`, one `409`)
- [ ] 100-iteration loop with reseed; zero tolerance for flakes
- [ ] Direct-SQL `CHECK` violation proof (raw `UPDATE seats_taken = 4` must fail)
- [ ] Add `npm run test:concurrency` script; wire into CI later (Phase 11)

**DoD:** 100/100 race runs pass; overbooking impossible by both application and constraint layers; evidence recorded for demo video.

## Phase 10 — Frontend Integration _(deps: 4–9 API complete)_

- [ ] Auth screens: `/login`, `/register` (role selector), token-in-memory client with silent refresh, logout, `?next=` redirect
- [ ] Passenger screens per [ui-ux §2](docs/ui-ux.md): dashboard, request-ride (ZonePicker, SeatStepper, live FareCard), rides list, ride detail (StatusTimeline + pay button + cancel)
- [ ] Driver screens: dashboard (online toggle, current trip), requests queue, pool detail (roster + state-derived action buttons), history
- [ ] Route middleware by role (UI convenience only — API remains authoritative)
- [ ] Polling hook (3 s, backoff, pause on hidden tab) driving active screens
- [ ] All UI states implemented per ui-ux §5 (loading/empty/error/disabled/unauthorized/no-seats) with error-code → copy mapping
- [ ] Responsive (375/768/1280) + a11y basics (landmarks, labels, focus, `aria-live`)

**DoD:** both journeys completable by a human on a clean seed, keyboard-only, at 375 px and 1280 px; zero raw status codes or stack traces ever rendered.

## Phase 11 — Testing _(deps: 10; extends tests written incrementally in 3–9)_

- [ ] Gap review: walk [traceability](docs/traceability.md) matrix row → named test; add any missing
- [ ] Playwright E2E: `passenger-journey.spec.ts`, `driver-journey.spec.ts`, negative slice (testing §7)
- [ ] `npm test` umbrella scripts; suite wall-clock < 2 min
- [ ] CI workflow: on PR → lint, typecheck, unit, integration (test Postgres service), (e2e on main/pre-release)
- [ ] Flake audit: run full suite 10× consecutively

**DoD:** CI green on a PR; every P0 row in the matrix has a test name; no flaky tests.

## Phase 12 — Docker _(deps: 4–10 stable)_

- [ ] `backend/Dockerfile` multi-stage (deps → build → `node:22-alpine`), `frontend/Dockerfile` (Next standalone)
- [ ] `docker-compose.yml`: `db` (volume + `pg_isready`), `api` (depends_on healthy → migrate → seed → start, healthcheck `/api/v1/health`), `web` (healthcheck `/`)
- [ ] Entrypoint script: `prisma migrate deploy && prisma db seed && node dist/server.js` (seed idempotent, prod-guarded)
- [ ] Fresh-clone smoke: `git clone` → `cp .env.example .env` → `docker compose up` → demo scenario runs
- [ ] `.env.example` parity check vs [security §6](docs/security.md)

**DoD:** a stranger with Docker reaches a working demo in < 15 min (Goal G1) using only the README.

## Phase 13 — Deployment _(deps: 12)_

- [ ] Neon free DB → `DATABASE_URL`; Render web service (Docker) env vars + `/api/v1/health` check; Vercel frontend env
- [ ] Production seed behavior verified (reference data only)
- [ ] Smoke test live: register, full trip, payment; confirm `Secure` cookies over https
- [ ] Rollback rehearsed (Vercel instant rollback; Render redeploy previous commit)
- [ ] Record real URLs into README (replace placeholders)

**DoD:** live URLs healthy; demo scenario passes against production; every free-tier claim re-verified on deployment day (deployment §2).

## Phase 14 — README _(deps: 13)_

- [ ] Sections: what/why, cast & demo, architecture diagram, **quickstart (`docker compose up`)**, env vars, migrations/seed, API summary (link `docs/api.md`), testing commands, deployment URLs, screenshots, branch/commit conventions
- [ ] **AI Usage section** (brief requirement): AI tools used · what they were used for · **one accepted suggestion** · **one rejected/modified suggestion** · why it was changed — filled with _actual_ project history only
- [ ] Link demo video (Phase 16) + docs/ index

**DoD:** README alone lets an evaluator run, test, and understand the project; AI section complete and truthful.

## Phase 15 — Git Release Process _(deps: 11–14)_

- [ ] Confirm branch model: `feature/*` → `main` → `pre-release` → `release/v1.0.0` (+ tag `v1.0.0`); close **D-03** (`main` vs `master` naming)
- [ ] Audit commit messages against `<type>(<scope>): <description>` (feat/fix/refactor/test/docs/chore/build)
- [ ] Squash/drop any meaningless commits; ensure no secrets/large files in history
- [ ] Tag + release branch cut from `pre-release` after final QA pass

**DoD:** tagged `release/v1.0.0` exists; history readable; conventions documented in README.

## Phase 16 — Demo Video _(deps: 15; content from PRD §16)_

- [ ] Record steps 1–10 of [PRD §16](docs/PRD.md) (~3 min), including fare values on screen (`৳115.20` × 2)
- [ ] Append concurrency proof (test run or dual-curl race showing `201` + `409`)
- [ ] Upload (YouTube unlisted/Drive), link in README, verify playback

**DoD:** video covers every §16 row with expected values visible; README link works.

---

## Final submission checklist

- [ ] All matrix rows in [docs/traceability.md](docs/traceability.md) still valid against the **original brief** (A-00 closed)
- [ ] Open decisions D-01…D-06 closed by the reviewer
- [ ] `docker compose up` from clean clone (no local tooling) works
- [ ] Full test suite green in CI; concurrency 100/100
- [ ] README + AI usage + video + docs/ present; deployment URLs live
- [ ] No secrets in git; `.gitignore` airtight; forbidden tech absent from package manifests
