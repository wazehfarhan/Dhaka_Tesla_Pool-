# Testing Strategy — Dhaka Tesla Pool (MVP)

Companion documents: [requirements](requirements.md) · [api](api.md) · [architecture](architecture.md) · [traceability](traceability.md)

## 1. Philosophy

We test **risky behaviour, not coverage numbers.** A coverage percentage is not an acceptance criterion anywhere in this project; the bar is: *every high-risk requirement in `requirements.md` (concurrency, capacity, state machine, authorization, fare math) has an automated test that fails when the rule breaks.* Docs-only stage: no test files exist yet — this document specifies them for Phase 11 of [todo.md](../todo.md).

## 2. Tooling and layout

| Layer | Tool | Runs against | Command (planned) |
|---|---|---|---|
| Unit | **Vitest** | pure functions/services, mocked repos | `npm run test:unit` |
| Integration | **Vitest + Supertest** | real Express app + real Postgres (compose test DB) | `npm run test:integration` |
| Concurrency | **Vitest + Supertest** | real app, real Postgres, parallel requests | included in integration |
| E2E | **Playwright** | full stack via `docker compose up` | `npm run test:e2e` |

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

| File | Covers requirement | Key cases |
|---|---|---|
| `fare.test.ts` | FR-FARE-001…003 | Banani→Dhanmondi 7 km: subtotal `14400`, discount `2880`, per-seat `11520` (the demo numbers — exact equality, integer math); discount = 0 when pool completes solo; floor rounding (`14400*15%` = `2160` exact, plus an odd-number case); seats multiplier (`perSeat × 3`); min-fare guard never triggers under current rate card |
| `matching.test.ts` | FR-POOL-002/003 | same corridor + OPEN + seats → match; different destination → no match; full pool → no match; no OPEN pool → create; OPEN pool exists but full → `POOL_CAPACITY_EXCEEDED` |
| `capacity.test.ts` | FR-POOL-004 | `seatsTaken + n <= capacity` boundary: 3/3 rejects 1 seat; 2/3 accepts 1 but rejects 2 |
| `stateMachine.test.ts` | FR-RIDE-001 | legal chain `REQUESTED→ACCEPTED→DRIVER_ARRIVED→STARTED→COMPLETED`; every illegal jump rejected (`COMPLETE` from `REQUESTED`, `START` from `ACCEPTED`, anything after `COMPLETED`); `CANCELLED` reachable only pre-`STARTED` |
| `cancellation.test.ts` | FR-PASSENGER-005 | last member cancels → pool `CANCELLED`; middle member cancels → seats freed, others unaffected; after `STARTED` → `RIDE_ALREADY_STARTED` |

## 4. Integration tests (Supertest + real DB)

| Test | Arranges | Asserts |
|---|---|---|
| `auth.test` | seed Jashim/Nusrat | register → login → `/auth/me`; duplicate email `409`; wrong password `401`; refresh rotates; logout kills refresh |
| `rideCreate.test` | Jashim online | Nusrat `POST /rides` Banani→Dhanmondi → `201`, `status=REQUESTED`, pool created, `seatsTaken=1`, estimate present; Rafiq same corridor → joins same `poolId`; Mehjabin different corridor → **new** pool |
| `poolAccept.test` | open pool | Jashim accept → `ACCEPTED` for pool **and** every member; passenger calling accept → `403`; re-accept → `409 ILLEGAL_STATE_TRANSITION` |
| `capacity.test` | pool at 2/3 | third join → `201` seats 3/3; fourth join → `409 POOL_CAPACITY_EXCEEDED`, `seatsTaken` still 3, no `pool_members` row |
| `farePersist.test` | completed trip | `fares` row is `FINAL` with `total_poisha=11520` per passenger (Nusrat **and** Rafiq individually), discount applied for ≥2 completers |
| `payment.test` | completed trip | payment `PENDING` → simulate → `PAID`, `method=SIMULATED`; repeat → still `PAID`, one row only |
| `cancel.test` | 2-member pool | Shirin cancels → her request/member `CANCELLED`, seats 1/2; Nusrat's ride untouched |
| `lifecycle.test` | full happy path | driver arrives → starts → completes: pool + all active members end `COMPLETED`, status history has every transition |

## 5. Authorization tests (explicit matrix)

Every case runs as the *wrong* actor and must fail exactly as specified:

1. Passenger A (Nusrat) GET/POST-cancel Passenger B's (Rafiq's) ride → **`404`** (ownership scope, not 403).
2. Passenger hits `POST /driver/pools/:id/accept` → **`403`**.
3. Driver (Jashim) hits `POST /rides` → **`403`**.
4. No token on any protected endpoint → **`401`**.
5. Tampered/forged JWT (bad signature) → **`401`**.
6. Driver acting on a pool that belongs to another driver's vehicle (fixture: second driver) → **`404`**.
7. Passenger attempts to "pay" another passenger's completed ride → **`404`**.

## 6. Concurrency test (the brief's headline scenario)

**Scenario under test:** *Bullet has one seat left and Nusrat and Shirin simultaneously attempt to claim it.*

**Setup (real app, real Postgres — not mocks):** seed a pool on Banani→Dhanmondi with `seat_capacity = 3` and two `ACTIVE` members (Rafiq + Mehjabin) → `seats_taken = 2`, exactly **1 seat free**.

**Procedure:**
```ts
// tests/concurrency/lastSeat.race.test.ts (shape, not final code)
const [a, b] = await Promise.all([
  api.post('/api/v1/rides').set(auth(nusrat)).send({ pickupZone:'Banani', destinationZone:'Dhanmondi', seats:1 }),
  api.post('/api/v1/rides').set(auth(shirin)).send({ pickupZone:'Banani', destinationZone:'Dhanmondi', seats:1 }),
]);
const ok = [a, b].filter(r => r.status === 201).length;
const rejected = [a, b].filter(r => r.status === 409 && r.body.error.code === 'POOL_CAPACITY_EXCEEDED').length;
expect(ok).toBe(1);            // exactly one winner
expect(rejected).toBe(1);      // exactly one clean rejection
// and afterwards, read the pool back:
expect(pool.seatsTaken).toBe(3);              // never 4
expect(activeMembers(pool)).toHaveLength(3);  // no phantom membership
expect(loser.ride).toBeUndefined();           // loser persisted nothing
```

**Strengthening:** wrap the `Promise.all` in a loop of **100 iterations** (re-seeding between runs) asserting the same invariants — this is Goal G2. Also assert the DB `CHECK` would have caught a hypothetical bypass: a direct raw `UPDATE pools SET seats_taken = 4` must fail with a constraint violation (proves defense-in-depth layer 1 works).

**Why real infrastructure:** mocks cannot exercise Postgres row locks, EvalPlanQual re-checks, or the partial unique index — the thing being tested *is* the database's behaviour under contention. The test runs against the compose test DB (`DATABASE_URL_TEST`), isolated from dev data.

**Reproducing manually (for the demo video):** run two `curl` joins in a bash loop with `&` to launch simultaneously; the response pair shows one `201` and one `409`.

## 7. End-to-end tests (Playwright)

Run against `docker compose up` full stack with seeded cast. Two specs, each asserting on visible UI, not internals:

**`passenger-journey.spec.ts`** — Nusrat logs in → dashboard empty state → request Banani→Dhanmondi, 1 seat → sees `৳115.20` estimate → submits → waiting card ("seats held") → *(driver spec drives the trip in the paired run, or the test switches to Jashim's context)* → observes `ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED` via polling → fare shows final `৳115.20` → clicks **Pay (simulated)** → `PAID` badge → opens `/passenger/rides` → ride present in history.

**`driver-journey.spec.ts`** — Jashim logs in → goes online → Requests queue shows the open pool (2/3 seats) → Accept → roster shows Nusrat + Rafiq → Arrive → Start → Complete → pool detail shows two `৳115.20` fares, both `PENDING` → `/driver/history` lists the completed pool.

**Negative E2E slice:** passenger attempts cancel after `STARTED` → button hidden; driving directly to `/driver/requests` as Nusrat → redirected to `/passenger`.

## 8. Test data (story cast only)

Seed users for tests/dev (never `user1`/`driver1`):

| Email | Name | Role | Notes |
|---|---|---|---|
| `jashim@example.com` | **Jashim** | DRIVER | owns **Bullet** (`Tesla Model 3`, `DHK-TSL-001`, 3 seats) |
| `nusrat@example.com` | **Nusrat** | PASSENGER | demo passenger #1 |
| `rafiq@example.com` | **Rafiq** | PASSENGER | demo passenger #2 |
| `shirin@example.com` | **Shirin** | PASSENGER | demo passenger #3 + race contender |
| `mehjabin@example.com` | **Mehjabin** | PASSENGER | fixture-only: holds seats in the concurrency-test pool |

Shared dev password `demo1234` (dev/test seed only; production seed creates reference data only). Zones and the 28 distances are seeded identically everywhere — tests hard-code **Banani→Dhanmondi = 7 km** and `11520` poisha as regression sentinels.

## 9. Execution & policy

- `npm run test:unit` · `npm run test:integration` · `npm run test:e2e` · `npm test` = all, must finish **< 2 min** (Goal G6).
- Integration/e2e run in CI on every PR (GitHub Actions, free tier): compose up test Postgres → migrate → seed → run.
- **No flaky tolerance:** the concurrency test must pass 100/100 locally before it enters CI; a flaky race test is a failed design, not a retry problem.
- Coverage is reported for visibility but is **not** a gate; the gate is: every P0 requirement in the [traceability matrix](traceability.md) has a named test.
