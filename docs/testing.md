# Testing Strategy — Dhaka Tesla Pool (MVP)

Companion documents: [requirements](requirements.md) · [api](api.md) · [architecture](architecture.md) · [traceability](traceability.md)

## 1. Philosophy

We test **risky behaviour, not coverage numbers.** A coverage percentage is not an acceptance criterion anywhere in this project; the bar is: _every high-risk requirement in `requirements.md` (concurrency, capacity, state machine, authorization, fare math) has an automated test that fails when the rule breaks._ Docs-only stage: no test files exist yet — this document specifies them for Phase 11 of [todo.md](../todo.md).

## 2. Tooling and layout

| Layer       | Tool                   | Runs against                                       | Command (planned)          |
| ----------- | ---------------------- | -------------------------------------------------- | -------------------------- |
| Unit        | **Vitest**             | pure functions/services, mocked repos              | `npm run test:unit`        |
| Integration | **Vitest + Supertest** | real Express app + real Postgres (compose test DB) | `npm run test:integration` |
| Concurrency | **Vitest + Supertest** | real app, real Postgres, parallel requests         | included in integration    |
| E2E         | **Playwright**         | full stack via `docker compose up`                 | `npm run test:e2e`         |

```text
backend/
├── src/**/__tests__/unit/       # fare.test.ts, matching.test.ts, stateMachine.test.ts, capacity.test.ts, cancellation.test.ts
├── tests/integration/           # auth, rides, pools, capacity, fare, payment, authz
└── tests/concurrency/           # lastSeat.race.test.ts
frontend/
└── e2e/                          # passenger-journey.spec.ts, driver-journey.spec.ts
```

Integration tests need an isolated database (`dhaka_tesla_pool_test`) recreated with `prisma migrate deploy` + seed per run — never the dev database.

## 3. Unit tests (pure logic, no HTTP/DB)

| File                   | Covers requirement         | Key cases                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fare.test.ts`         | FR-FARE-001…003            | Banani→Dhanmondi 7 km: subtotal `14400`, discount `2880`, per-seat `11520` (the demo numbers — exact equality, integer math); discount = 0 when pool completes solo; floor rounding (`14400*15%` = `2160` exact, plus an odd-number case); seats multiplier (`perSeat × 3`); min-fare guard never triggers under current rate card |
| `matching.test.ts`     | FR-POOL-002/003            | same corridor + OPEN + seats → match; different destination → no match; full pool → no match; no OPEN pool → create; OPEN pool exists but full → `POOL_CAPACITY_EXCEEDED`                                                                                                                                                          |
| `capacity.test.ts`     | FR-POOL-004                | `seatsTaken + n <= capacity` boundary: 3/3 rejects 1 seat; 2/3 accepts 1 but rejects 2                                                                                                                                                                                                                                             |
| `stateMachine.test.ts` | FR-RIDE-001, FR-DRIVER-003 | the driver progression table (`OPEN→ACCEPTED→DRIVER_ARRIVED→STARTED→COMPLETED`): the legal chain walks end-to-end; every illegal jump is refused with `expected` = the status that action needs; nothing is legal after `COMPLETED`; `CANCELLED` is unreachable by a driver action (Phase 8 owns cancelling)                       |
| `cancellation.test.ts` | FR-PASSENGER-005           | last member cancels → pool `CANCELLED`; middle member cancels → seats freed, others unaffected; after `STARTED` → `RIDE_ALREADY_STARTED`                                                                                                                                                                                           |

## 4. Integration tests (Supertest + real DB)

| Test               | Arranges                                                      | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.test`        | seed Jashim/Nusrat                                            | register → login → `/auth/me`; duplicate email `409`; wrong password `401`; refresh rotates; logout kills refresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `rideCreate.test`  | Jashim online                                                 | Nusrat `POST /rides` Banani→Dhanmondi → `201`, `status=REQUESTED`, pool created, `seatsTaken=1`, estimate present; Rafiq same corridor → joins same `poolId`; Mehjabin different corridor → **new** pool                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `poolAccept.test`  | open pool                                                     | Jashim accept → `ACCEPTED` for pool **and** every member; passenger calling accept → `403`; re-accept → `409 ILLEGAL_STATE_TRANSITION`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `capacity.test`    | pool at 2/3                                                   | third join → `201` seats 3/3; fourth join → `409 POOL_CAPACITY_EXCEEDED`, `seatsTaken` still 3, no `pool_members` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `farePersist.test` | completed trip                                                | `fares` row is `FINAL` with `total_poisha=11520` per passenger (Nusrat **and** Rafiq individually), discount applied for ≥2 completers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `payment.test`     | completed trip                                                | payment `PENDING` → simulate → `PAID`, `method=SIMULATED`; repeat → still `PAID`, one row only — **delivered by `cancellation.test.ts`**, together with the `404` before completion and the `409` before `COMPLETED`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `cancel.test`      | 2-member pool                                                 | Shirin cancels → her request/member `CANCELLED`, seats 1/2; Nusrat's ride untouched — **delivered by `cancellation.test.ts`**, which also asserts the seat invariant after every scenario and the `POOL_EMPTY` cascade                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `lifecycle.test`   | full happy path                                               | driver arrives → starts → completes: pool + all active members end `COMPLETED`, status history has every transition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `driverFlow.test`  | 2-member `OPEN` pool (two `POST /rides` on the demo corridor) | driver queue/detail: roster with `ESTIMATED` fares and `null` payments, corridor names, `distanceKm`, pagination meta, `?status=` filters, own-scope only; `accept` → pool **and** every member `ACCEPTED` + history rows; re-accept and any out-of-order action → `409 ILLEGAL_STATE_TRANSITION` with `details {current, expected}`; foreign/unknown pool → `404`; `complete` → `FINAL` `11520` + `PENDING` payment per member in one transaction, the passenger's own `GET /rides/:id` agrees, `?status=COMPLETED` is the driver's history; a cancelled member stays `CANCELLED`, undiscounted (`14400`) for the lone completer and unpaid |
| `vehicles.test`    | driver garage (`GET`/`POST`/`PATCH`)                          | own vehicles only, oldest first; `201` starts `OFFLINE`; duplicate plate → `409 CONFLICT` (fleet-wide UNIQUE); capacity outside 1…8 / unknown key → `400`; toggle answers `{id, status}`; foreign/unknown id → `404`, malformed id or status → `400`; `ONLINE` is what lets a new ride request match (`NO_VEHICLE_AVAILABLE` otherwise) and that pool appears in the owner's queue                                                                                                                                                                                                                                                           |

Driver-side `poolAccept.test` / `lifecycle.test` / `farePersist.test` cases are delivered by `driver-flow.test.ts` (same scenarios, one file). Its fixture seeds users with the real token service instead of `POST /auth/login`: bcrypt at cost 12 (security.md §1) costs ~430 ms per call, which would otherwise dominate the suite — the credential exchange itself stays `auth.test.ts`'s subject.

## 5. Authorization tests (explicit matrix)

Every case runs as the _wrong_ actor and must fail exactly as specified:

1. Passenger A (Nusrat) GET/POST-cancel Passenger B's (Rafiq's) ride → **`404`** (ownership scope, not 403).
2. Passenger hits `POST /driver/pools/:id/accept` → **`403`**.
3. Driver (Jashim) hits `POST /rides` → **`403`**.
4. No token on any protected endpoint → **`401`**.
5. Tampered/forged JWT (bad signature) → **`401`**.
6. Driver acting on a pool that belongs to another driver's vehicle (fixture: second driver) → **`404`**.
7. Passenger attempts to "pay" another passenger's completed ride → **`404`**.

## 6. Concurrency test (the brief's headline scenario)

**Scenario under test:** _Bullet has one seat left and Nusrat and Shirin simultaneously attempt to claim it._

**Setup (real app, real Postgres — not mocks):** seed a pool on Banani→Dhanmondi with `seat_capacity = 3` and two `ACTIVE` members (Rafiq + Mehjabin) → `seats_taken = 2`, exactly **1 seat free**.

**Procedure (as delivered — `backend/tests/concurrency/lastSeat.race.test.ts`):** the real Express app is built against a real `Database` (`createDatabase(DATABASE_URL_TEST)`), and the fixture is **re-seeded from scratch every iteration** (`TRUNCATE … RESTART IDENTITY CASCADE`) so a row left by a previous iteration can never make a later one pass. Each iteration then fires both `POST /api/v1/rides` in the same tick via `Promise.all` and asserts, in order: exactly one `201`; exactly one `409 POOL_CAPACITY_EXCEEDED`; the winner joined the pool both tried to join; `seats_taken = 3` read back from the database (**never 4**); exactly three `ACTIVE` memberships; and that the loser persisted **no ride row and no fare row** — the whole transaction rolled back, not just the claim.

**Defense in depth, bypassing the application entirely:** three sibling tests ask Postgres directly. A raw `UPDATE pools SET seats_taken = 4` must fail the `CHECK` (and leave the row untouched); a second `OPEN` pool on the same corridor must fail `idx_unique_open_pool_per_corridor`, while a `CANCELLED` one is accepted — that is precisely what "partial" buys; a duplicate seat-ledger row must fail `UNIQUE (ride_request_id)`.

**Strengthening:** the loop runs **100 iterations** by default (Goal G2, zero tolerance for flakes). `CONCURRENCY_ITERATIONS` lowers it for a quick local edit loop; CI leaves it at 100. The suite has its own Vitest config (`npm run test:concurrency`) and is excluded from the default, database-free suite. Its global setup **fails loudly** when `DATABASE_URL_TEST` is missing — a race test that quietly skips proves nothing.

**One finding worth keeping:** the first 100-run attempt failed at iteration 51 with _zero_ winners. The cause was our own rate limiter answering `429 RATE_LIMITED` (100 req/min, security.md §5), which from the test's point of view is indistinguishable from a lost race. The fix was a documented `RATE_LIMIT_MAX` / `RATE_LIMIT_MAX_AUTH` env knob — the middleware stays real, only its ceiling becomes tunable — rather than disabling rate limiting for tests.

**Why real infrastructure:** mocks cannot exercise Postgres row locks, EvalPlanQual re-checks, or the partial unique index — the thing being tested _is_ the database's behaviour under contention. The test runs against the compose test DB (`DATABASE_URL_TEST`), isolated from dev data.

**Reproducing manually (for the demo video):** `./scripts/smoke.sh` step 6 does exactly this over HTTP with two `curl` joins launched with `&`, and asserts one `201`, one `409 POOL_CAPACITY_EXCEEDED`, and a pool that never overbooks.

## 7. End-to-end tests (Playwright)

Run against `docker compose up` full stack with seeded cast. Two specs, each asserting on visible UI, not internals:

**`passenger-journey.spec.ts`** — Nusrat logs in → dashboard empty state → request Banani→Dhanmondi, 1 seat → sees `৳115.20` estimate → submits → waiting card ("seats held") → _(driver spec drives the trip in the paired run, or the test switches to Jashim's context)_ → observes `ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED` via polling → fare shows final `৳115.20` → clicks **Pay (simulated)** → `PAID` badge → opens `/passenger/rides` → ride present in history.

**`driver-journey.spec.ts`** — Jashim logs in → goes online → Requests queue shows the open pool (2/3 seats) → Accept → roster shows Nusrat + Rafiq → Arrive → Start → Complete → pool detail shows two `৳115.20` fares, both `PENDING` → `/driver/history` lists the completed pool.

**Negative E2E slice:** passenger attempts cancel after `STARTED` → button hidden; driving directly to `/driver/requests` as Nusrat → redirected to `/passenger`.

## 8. Test data (story cast only)

Seed users for tests/dev (never `user1`/`driver1`):

| Email                  | Name         | Role      | Notes                                                     |
| ---------------------- | ------------ | --------- | --------------------------------------------------------- |
| `jashim@example.com`   | **Jashim**   | DRIVER    | owns **Bullet** (`Tesla Model 3`, `DHK-TSL-001`, 3 seats) |
| `nusrat@example.com`   | **Nusrat**   | PASSENGER | demo passenger #1                                         |
| `rafiq@example.com`    | **Rafiq**    | PASSENGER | demo passenger #2                                         |
| `shirin@example.com`   | **Shirin**   | PASSENGER | demo passenger #3 + race contender                        |
| `mehjabin@example.com` | **Mehjabin** | PASSENGER | fixture-only: holds seats in the concurrency-test pool    |

Shared dev password `demo1234` (dev/test seed only; production seed creates reference data only). Zones and the 28 distances are seeded identically everywhere — tests hard-code **Banani→Dhanmondi = 7 km** and `11520` poisha as regression sentinels.

## 9. Execution & policy

- `npm run test:unit` · `npm run test:integration` · `npm run test:e2e` · `npm test` = all, must finish **< 2 min** (Goal G6).
- Integration/e2e run in CI on every PR (GitHub Actions, free tier): compose up test Postgres → migrate → seed → run.
- **No flaky tolerance:** the concurrency test must pass 100/100 locally before it enters CI; a flaky race test is a failed design, not a retry problem.
- Coverage is reported for visibility but is **not** a gate; the gate is: every P0 requirement in the [traceability matrix](traceability.md) has a named test.
