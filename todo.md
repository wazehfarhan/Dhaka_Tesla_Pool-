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

- [x] Vehicles: `GET/POST /vehicles`, `PATCH /vehicles/:id` (online toggle, owner-only)
- [x] `GET /driver/pools` (status filter incl. `OPEN` queue + `COMPLETED` history) + `GET /driver/pools/:id` (roster + fares)
- [x] `POST /driver/pools/:id/accept|arrive|start|complete` — conditional transitions + cascade to active members + status history, one transaction each
- [x] Integration tests: progression happy path, out-of-order `409`s, passenger → `403`, foreign pool → `404`

**DoD:** full trip progression drivable via API tests alone (no UI yet); every transition writes history rows. ✅ — `state-machine.test.ts` (7 pure tests over the transition table), `driver-flow.test.ts` (14 HTTP tests: queue/detail, `accept`/`arrive`/`start`/`complete`, the `409 ILLEGAL_STATE_TRANSITION` envelope with `{current, expected}`, foreign/unknown → `404`, the 401/403 matrix) and `vehicles.test.ts` (8 tests, including the documented effect that `ONLINE` gates new ride requests); suite **134/134**. Design notes: `driver.transitions.ts` is a pure `DRIVER_TRANSITIONS` table + `decideTransition()` — the service only _applies_ it; each transition is one `$transaction`: ownership lookup → status-gated `updateMany` (`count === 0` → re-read → `409` `{current, expected}`) → cascade the new status onto every non-`CANCELLED` ride → append the `POOL` row plus one `RIDE_REQUEST` row per cascaded ride (`DRIVER_ACCEPTED` / `DRIVER_ARRIVED` / `TRIP_STARTED` / `TRIP_COMPLETED`) → on `complete`, `finalizeRideFare(rideId, completers, tx)` (now transaction-aware through an optional client; FR-FARE-004 stays write-once) and one `payment.create({status:'PENDING'})` per active member. A member who cancelled keeps `CANCELLED` (the cascade skips it), is excluded from the `≥ 2` completer discount rule and gets no payment. Foreign/unknown pool and vehicle ids are `404`, never `403` (api.md §1 — no ID probing). Still open: `POST /driver/pools/:id/cancel` (api.md §6.5), the payments endpoints (api.md §8) and the cancellation clause of `stateMachine.test.ts` — all Phase 8.

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
- [x] `fares` row lifecycle: `ESTIMATED` at create → `FINAL` at pool completion (discount iff ≥ 2 active completers; `perSeat × seats`) — _`saveEstimate` is wired into `POST /rides` (Phase 4 ✅, inside the matching transaction); closed by Phase 5's completion transaction (`driver.service.transition('complete')` → `finalizeRideFare(rideId, completers, tx)` + the `PENDING` payment row), proven by `driver-flow.test.ts` — `FINAL` `11520` with the `2880` discount for two completers, `14400` undiscounted for a lone one_
- [x] Unit tests: the worked example (`14400 → 2880 → 11520`), solo = no discount, floor rounding, min-fare guard, seats multiplier

**DoD:** `fare.test.ts` proves hand-calculated demo values byte-for-byte; no float in the money path (grep-verified). ✅ — suite 54/54 green; grep finds no float API and no decimal values in executable fare code (only taka figures inside comments, mirroring PRD §12.3).

## Phase 8 — Cancellation _(deps: 4, 5, 6, 7)_

- [x] `POST /rides/:id/cancel`: pre-start only, frees seats atomically, membership → `CANCELLED`, empty pool → `CANCELLED`
- [x] Driver pool cancel (pre-start) cascading to active members
- [x] Status-history reasons (`PASSENGER_CANCELLED`, `DRIVER_CANCELLED`, `POOL_EMPTY`)
- [x] Tests: seat accounting after mixed cancel/join, post-start `409`, others unaffected, pool-empty cascade
- [x] **Added (documented in [api.md §8](docs/api.md) but missing from this plan):** `GET /rides/:id/payment` + `POST /rides/:id/payment/simulate` — the PRD demo ends with Nusrat tapping **Pay (simulated)** and no box here covered it

**DoD:** invariant `seats_taken = Σ ACTIVE memberships` holds after every test scenario (asserted directly in SQL). ✅ — `decideCancel()` (pure, beside the progression table) decides the three outcomes; each cancel is **one transaction**: conditional ride/pool flip → membership `CANCELLED` → raw conditional seat release (the mirror of matching's claim, so the invariant survives a race) → history row. The last member out cancels the pool with reason `POOL_EMPTY` and a **null actor** (nobody chose it). A cancelled trip is never charged: the fare stays `ESTIMATED`, no payment row (A-07). `cancellation.test.ts` (14 tests) asserts the seat invariant after _every_ scenario and covers the payment lifecycle (404 before completion, idempotent `PENDING → PAID`, `409` before `COMPLETED`); 4 pure cancel-rule tests live in `state-machine.test.ts`; driver pool cancel is in `driver-flow.test.ts`. Suite **157/157**.

## Phase 9 — Concurrency _(deps: 6, 8)_

- [x] `lastSeat.race.test.ts` exactly as [testing §6](docs/testing.md) (1 seat free → two claimants → one `201`, one `409`)
- [x] 100-iteration loop with reseed; zero tolerance for flakes
- [x] Direct-SQL `CHECK` violation proof (raw `UPDATE seats_taken = 4` must fail)
- [x] Add `npm run test:concurrency` script; wire into CI later (Phase 11)

**DoD:** 100/100 race runs pass; overbooking impossible by both application and constraint layers; evidence recorded for demo video. ✅ — `tests/concurrency/lastSeat.race.test.ts` runs against a **real** Postgres under its own Vitest config (the default suite stays database-free and fast) and re-seeds the entire fixture each iteration, so a stale row can never make a later run pass. Each iteration asserts one `201`, one clean `409 POOL_CAPACITY_EXCEEDED`, `seats_taken = 3` read back from the database, three `ACTIVE` memberships, and that the loser persisted no ride **and** no fare. Three further tests bypass the application entirely: a raw `UPDATE pools SET seats_taken = 4` must fail the `CHECK`; a second `OPEN` pool on the same corridor must fail the partial unique index (a `CANCELLED` one is allowed — that is what "partial" buys); a duplicate ledger row must fail `UNIQUE (ride_request_id)`. **100/100 green**, and `./scripts/smoke.sh` reproduces a single live race over HTTP for the demo video. Design note: the first 100-run attempt failed at iteration 51 — not a lost seat, but our own `100 req/min` limiter answering `429`, which is indistinguishable from a lost race. Resolved with a documented `RATE_LIMIT_MAX` env knob (the limiter stays real, only its ceiling becomes tunable) rather than by disabling middleware.

## Phase 10 — Frontend Integration _(deps: 4–9 API complete)_

- [x] Auth screens: `/login`, `/register` (role selector), token-in-memory client with silent refresh, logout, `?next=` redirect
- [x] Passenger screens per [ui-ux §2](docs/ui-ux.md): dashboard, request-ride (ZonePicker, SeatStepper, live FareCard), rides list, ride detail (StatusTimeline + pay button + cancel)
- [x] Driver screens: dashboard (online toggle, current trip), requests queue, pool detail (roster + state-derived action buttons), history
- [x] Route middleware by role (UI convenience only — API remains authoritative)
- [x] Polling hook (3 s, backoff, pause on hidden tab) driving active screens
- [x] All UI states implemented per ui-ux §5 (loading/empty/error/disabled/unauthorized/no-seats) with error-code → copy mapping
- [x] Responsive (375/768/1280) + a11y basics (landmarks, labels, focus, `aria-live`)
- [ ] Playwright E2E specs — **left explicitly open** with Phase 11's E2E box: browser automation needs a Playwright install plus its own CI job, and the same two journeys are already asserted end-to-end by `scripts/smoke.sh` against the real stack

**DoD:** both journeys completable by a human on a clean seed, keyboard-only, at 375 px and 1280 px; zero raw status codes or stack traces ever rendered. ✅ — passenger screens first, driver screens once the API landed: the `/driver` placeholder (which honestly listed the missing endpoints) became the real dashboard — garage with the online toggle and an add-vehicle form, the active trip, the Requests queue — plus `/driver/pools/[id]` (roster with per-passenger fare and payment, pool timeline, action buttons) and `/driver/history`. The buttons come from `nextDriverAction()`, a mirror of the backend's `DRIVER_TRANSITIONS` table, so the UI never offers a move the API would refuse with `409`; the passenger's Cancel and Pay are live mutations that re-read the ride afterwards. Money stays integer poisha in the DOM (`data-poisha`) with `৳115.20` rendered for humans, and every API code maps to human copy in `lib/errors.ts`.

## Phase 11 — Testing _(deps: 10; extends tests written incrementally in 3–9)_

- [x] Gap review: walk [traceability](docs/traceability.md) matrix row → named test; add any missing
- [ ] Playwright E2E: `passenger-journey.spec.ts`, `driver-journey.spec.ts`, negative slice (testing §7) — **not done**, deliberately: the two journeys are asserted end-to-end by `scripts/smoke.sh` over HTTP against the real Compose stack, and half-installing browser automation would add a dependency and a CI job that prove less than what already runs
- [x] `npm test` umbrella scripts; suite wall-clock < 2 min
- [x] CI workflow: on PR → lint, typecheck, unit, integration (test Postgres service), (e2e on main/pre-release)
- [x] Flake audit: run full suite 10× consecutively

**DoD:** CI green on a PR; every P0 row in the matrix has a test name; no flaky tests. ✅ — `.github/workflows/ci.yml` runs four jobs: **quality** (lint, typecheck, the 157-test default suite, build, prettier), **concurrency** (a Postgres service container + the 100-iteration race), **images** (`docker compose build`, then `scripts/smoke.sh` against the built stack — a broken Dockerfile fails CI instead of a reviewer) and **flake-audit** (`scripts/flake-audit.sh 10`, failing on the first non-green run). Default suite wall-clock ~14 s. Traceability rows 9–15 all name a real suite (`cancellation.test.ts`, `driver-flow.test.ts`, `state-machine.test.ts`, `vehicles.test.ts`, testing §5 items 1–7).

## Phase 12 — Docker _(deps: 4–10 stable)_

- [x] `backend/Dockerfile` multi-stage (deps → build → `node:22-alpine`), `frontend/Dockerfile` (Next standalone)
- [x] `docker-compose.yml`: `db` (volume + `pg_isready`), `api` (depends_on healthy → migrate → seed → start, healthcheck `/api/v1/health`), `web` (healthcheck `/login`)
- [x] Entrypoint script: `prisma migrate deploy && prisma db seed && node dist/server.js` (seed idempotent, prod-guarded)
- [x] Fresh-clone smoke: `git clone` → `cp .env.example .env` → `docker compose up` → demo scenario runs
- [x] `.env.example` parity check vs [security §6](docs/security.md)

**DoD:** a stranger with Docker reaches a working demo in < 15 min (Goal G1) using only the README. ✅ — verified end to end on this machine from a clean volume: `docker compose down -v && docker compose up -d --build` brings up db → api (migrated + seeded) → web, and `./scripts/smoke.sh` then passes **22 assertions**, including the live one-seat race (one `201`, one `409`, the pool never overbooks). Three build traps worth recording, because each costs an hour otherwise: the workspace hoist means `backend/node_modules` may not exist at all (copying it unconditionally fails the build); Prisma 7 only discovers `prisma7.config.ts` from the `backend/` working directory, so the entrypoint `cd`s there; and the seed runs from source through `tsx`, so the image needs the _source_ generated client alongside `dist`'s. The web image also needed `outputFileTracingRoot` pointed at the repo root, without which the standalone bundle misses hoisted modules.

## Phase 13 — Deployment _(deps: 12)_

- [ ] Neon free DB → `DATABASE_URL`; Render web service (Docker) env vars + `/api/v1/health` check; Vercel frontend env
- [ ] Production seed behavior verified (reference data only)
- [ ] Smoke test live: register, full trip, payment; confirm `Secure` cookies over https
- [ ] Rollback rehearsed (Vercel instant rollback; Render redeploy previous commit)
- [ ] Record real URLs into README (replace placeholders)

**DoD:** live URLs healthy; demo scenario passes against production; every free-tier claim re-verified on deployment day (deployment §2).

## Phase 14 — README _(deps: 13)_

- [x] Sections: what/why, cast & demo, architecture diagram, **quickstart (`docker compose up`)**, env vars, migrations/seed, API summary (link `docs/api.md`), testing commands, deployment URLs, screenshots, branch/commit conventions
- [x] **AI Usage section** (brief requirement): AI tools used · what they were used for · **one accepted suggestion** · **one rejected/modified suggestion** · why it was changed — filled with _actual_ project history only
- [ ] Link demo video (Phase 16) + screenshots — blocked on recording
- [ ] Record live deployment URLs — blocked on Phase 13 accounts

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

- [x] All matrix rows in [docs/traceability.md](docs/traceability.md) still valid against the **original brief** (A-00 closed) — every P0 row names a suite that exists (`cancellation.test.ts`, `driver-flow.test.ts`, `state-machine.test.ts`, `vehicles.test.ts`, testing §5 items 1–7)
- [ ] Open decisions D-01…D-06 closed by the reviewer — **needs a human**: each is a product/architecture question ([traceability.md](docs/traceability.md) §"Open decisions"), not a coding task. What the implementation assumed is recorded there and in the docs the code was built from
- [x] `docker compose up` from clean clone (no local tooling) works — verified from `docker compose down -v` on this machine: db → api (migrated + seeded) → web, then `scripts/smoke.sh` green
- [x] Full test suite green; concurrency **100/100** — locally green (157 tests, ~15 s) and the same commands run in `.github/workflows/ci.yml`; the first CI run is the human-visible confirmation
- [ ] README + AI usage + **video** + docs/ present; deployment URLs live — README, AI usage and all 10 docs are present; the **video (Phase 16)** and the **live URLs (Phase 13)** need a human: recording, and accounts on Vercel/Render/Neon
- [x] No secrets in git; `.gitignore` airtight; forbidden tech absent from package manifests — history audited (no `.env` tracked, no blob > 500 kB, no literal secrets), and all 20 commits follow `<type>(<scope>): <description>`

**What a reviewer can do right now:** `git clone` → `cp .env.example .env` → `docker compose up --build` → open `http://localhost:3000` → `./scripts/smoke.sh` in a second terminal for the 22-assertion demo including the seat race.
