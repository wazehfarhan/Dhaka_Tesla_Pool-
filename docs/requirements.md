# Requirements Specification — Dhaka Tesla Pool (MVP)

Companion documents: [PRD](PRD.md) · [architecture](architecture.md) · [database](database.md) · [api](api.md) · [testing](testing.md) · [traceability](traceability.md)

## 1. Purpose

This document is the authoritative, testable statement of **what** the system must do. `architecture.md`/`api.md` describe _how_; `testing.md` describes _how we prove it_. Every requirement here has an ID that appears in the [traceability matrix](traceability.md).

## 2. How to read a requirement

Each functional requirement (FR) states: **ID — name**, the requirement, the actor, preconditions, expected behavior, validation, and acceptance criteria. A requirement is "done" only when its acceptance criteria are covered by an automated test (unit, integration, or E2E) listed in `testing.md`.

Non-functional requirements use IDs `NFR-*`. Ambiguities resolved by assumption carry an `A-xx` reference into [traceability.md](traceability.md).

## 3. Functional Requirements — Authentication

**FR-AUTH-001 — Register.** A visitor can register with `name`, `email`, `password`, and `role` (`PASSENGER` | `DRIVER`).

- Actor: anonymous visitor. Precondition: email not already registered.
- Expected behavior: password is hashed (bcrypt, cost ≥ 12); user row created; returns `201` with user profile (never the hash).
- Validation: `name` 2–80 chars; `email` valid format, unique (case-insensitive); `password` ≥ 8 chars; `role` one of the two enums.
- Acceptance: duplicate email → `409 EMAIL_TAKEN`; weak password → `400 VALIDATION_ERROR`; created user can log in immediately.

**FR-AUTH-002 — Login.** A registered user can log in with email + password.

- Actor: anonymous visitor. Precondition: user exists.
- Expected behavior: on success, an **access token** (JWT, 15 min) is returned in the response body and a **refresh token** (JWT, 7 days) is set as an `httpOnly`, `SameSite=Lax` cookie.
- Validation: constant-time failure — wrong password and unknown email both return `401 INVALID_CREDENTIALS` with the same message.
- Acceptance: valid credentials → `200` + profile + token; invalid → `401`; no password material in any response or log line.

**FR-AUTH-003 — Refresh and logout.** A client can rotate its access token via the refresh cookie and can log out.

- Expected behavior: `POST /auth/refresh` validates the refresh cookie and returns a new access token (rotation: old refresh token invalidated); `POST /auth/logout` clears the cookie and invalidates the refresh token.
- Acceptance: refresh without cookie → `401`; after logout the same refresh token cannot be used again.

**FR-AUTH-004 — Current user.** An authenticated client can fetch its own profile (`GET /auth/me`).

- Acceptance: no/invalid token → `401 UNAUTHENTICATED`; valid token → `200` with `id`, `name`, `email`, `role`.

**FR-AUTH-005 — Role separation.** Every endpoint declares a required role; middleware rejects mismatches with `403 FORBIDDEN`.

- Acceptance: a `PASSENGER` calling any `/driver/*` endpoint gets `403`; a `DRIVER` calling `POST /rides` gets `403`; unauthenticated access to protected routes gets `401`.

## 4. Functional Requirements — Passenger

**FR-PASSENGER-001 — Dashboard.** A passenger sees their active ride (if any), its live status, and a "Request ride" action.

- Actor: `PASSENGER`. Precondition: authenticated.
- Expected behavior: renders active ride card (pool, corridor, status, seats, estimated fare) or an empty state.
- Acceptance: with an active ride the card links to `/passenger/rides/:id`; without one, the empty state offers the request flow.

**FR-PASSENGER-002 — Request a ride.** A passenger requests a ride by choosing pickup zone, destination zone (≠ pickup), and seats (1…capacity).

- Precondition: at least one Tesla `ONLINE`; caller has no other ride in `REQUESTED/ACCEPTED/DRIVER_ARRIVED/STARTED` (one active ride at a time — Assumption A-06).
- Expected behavior: fare estimate available **before** creation; on create, matching runs (FR-POOL-002) and the response returns the request with `status = REQUESTED`, `poolId`, reserved seats, estimate.
- Validation: zones exist and differ; `seats` integer within capacity; optional `clientRequestId` (UUID) for idempotency.
- Acceptance: valid → `201`; replay with same `clientRequestId` → original ride, no duplicate; no online vehicle → `409 NO_VEHICLE_AVAILABLE`; full corridor → `409 POOL_CAPACITY_EXCEEDED`.

**FR-PASSENGER-003 — List own rides (history input).** `GET /rides` with pagination + optional `status` filter returns only the caller's rides.

- Acceptance: ownership enforced in the query (another passenger's ride never appears); page 2 of 25 seeded rides with `limit=20` returns 5.

**FR-PASSENGER-004 — Ride detail.** `GET /rides/:id` returns pool info, status timeline, fare, payment status.

- Acceptance: foreign or unknown ID → `404 NOT_FOUND`; own ride → `200` with timeline entries in chronological order.

**FR-PASSENGER-005 — Cancel own ride.** Cancel while `status ∈ {REQUESTED, ACCEPTED, DRIVER_ARRIVED}`.

- Expected behavior: request → `CANCELLED`, membership → `CANCELLED`, seats freed atomically; pool with no active members left → `CANCELLED`.
- Validation: after `STARTED` → `409 RIDE_ALREADY_STARTED`; foreign ride → `404`. No cancellation fee (PRD §14).
- Acceptance: `seats_taken` decreases by exactly the freed seats; other members unaffected.

**FR-PASSENGER-006 — Simulate payment.** After completion, the passenger marks their payment paid.

- Precondition: ride `COMPLETED`, payment `PENDING`. Expected: payment → `PAID`, `method = SIMULATED`, `paid_at` set; idempotent repeat returns same `PAID`.
- Acceptance: paying a non-completed ride → `409 ILLEGAL_STATE_TRANSITION`; one row per ride ever.

## 5. Functional Requirements — Driver & Vehicle

**FR-DRIVER-001 — Go online/offline.** Jashim toggles Bullet's availability (`PATCH /vehicles/:id {status}`).

- Acceptance: passenger request while all vehicles `OFFLINE` → `409 NO_VEHICLE_AVAILABLE`; toggling is allowed even with `OPEN` pools waiting (they simply remain waitable).

**FR-DRIVER-002 — View open pools.** `GET /driver/pools?status=OPEN` lists pools of the driver's vehicle: corridor, `seats_taken/seat_capacity`, members, estimate.

- Acceptance: only the driver's own vehicle's pools are returned (foreign vehicle → not present; direct ID → `404`).

**FR-DRIVER-003 — Accept a pool.** `POST /driver/pools/:id/accept`.

- Precondition: pool `OPEN`. Expected: pool → `ACCEPTED` **and every active member's ride → `ACCEPTED`** in one transaction, status-history rows appended for both entities.
- Validation: not `OPEN` → `409 ILLEGAL_STATE_TRANSITION`; pool of another driver → `404`; passenger → `403`.
- Acceptance: accepting updates all members atomically; a member cancelled earlier stays `CANCELLED`.

**FR-DRIVER-004 — Arrive → Start → Complete.** `POST …/arrive` (`ACCEPTED→DRIVER_ARRIVED`), `POST …/start` (`DRIVER_ARRIVED→STARTED`), `POST …/complete` (`STARTED→COMPLETED`).

- Expected on complete: each active member's fare becomes `FINAL` (discount iff ≥ 2 active members complete), a `PENDING` payment row is created per member, history appended.
- Acceptance: any out-of-order call → `409 ILLEGAL_STATE_TRANSITION` with current status in `details`; completion writes fares + payments for _every_ active member in the same transaction.

**FR-DRIVER-005 — Cancel pool (pre-start).** Driver cancels a pool not yet `STARTED` → pool + all active member rides `CANCELLED`, seats released.

- Acceptance: after `STARTED` → `409`; members' history retains the full transition trail.

**FR-VEHICLE-001 — Register vehicle.** Driver registers a Tesla: `model`, `plate` (unique), `seat_capacity` (1…8, `CHECK`). Seed registers **Bullet** (`Tesla Model 3`, `DHK-TSL-001`, capacity 3 — Assumption A-02).

- Acceptance: duplicate plate → `409`; capacity is snapshotted onto pools at creation.

**FR-VEHICLE-002 — Vehicle status.** `ONLINE | OFFLINE`, default `OFFLINE`; only the owner may change it (others → `404`).

## 6. Functional Requirements — Rides & Pooling

**FR-POOL-001 — Deterministic pool formation.** A ride request always lands in a pool for its ordered corridor: an existing `OPEN` pool (same pickup + destination + vehicle online) or a brand-new `OPEN` pool created atomically with the request.

- Actor: `PASSENGER` (via `POST /rides`). Precondition: validation passed (FR-PASSENGER-002).
- Expected behavior: exactly one `pool_id` per request; partial unique index permits one `OPEN` pool per (vehicle, corridor); racing creators resolve by unique-violation retry (join the winner's pool).
- Validation: corridor equality checked by service; DB backs it with the partial unique index.
- Acceptance: Nusrat's and Rafiq's Banani→Dhanmondi requests share one `pool_id`; Mehjabin's Mirpur→Uttara request gets a different pool; two simultaneous "first ever" requests end up in **one** pool, not two.

**FR-POOL-002 — Join an existing pool.** The five matching conditions of [PRD §11](PRD.md) must all hold (OPEN, same corridor, seats fit, vehicle online, no active ride).

- Acceptance: violating any condition → documented error code (`POOL_CAPACITY_EXCEEDED` / `NO_VEHICLE_AVAILABLE` / `ACTIVE_RIDE_EXISTS`), nothing persisted.

**FR-POOL-003 — Pool visibility.** Members see their pool (roster count, seats) on the ride detail; the driver sees full rosters on pool detail.

- Acceptance: passenger sees member _count_ and seat occupancy, not other passengers' identities beyond first names (privacy note — MVP shows names; PII minimization listed as NFR-SEC-004).

**FR-POOL-004 — Capacity enforcement (atomic).** `seats_taken` may never exceed `seat_capacity`, under any concurrency.

- Actor: system. Precondition: pool exists.
- Expected behavior: single conditional `UPDATE … WHERE seats_taken + n ≤ seat_capacity` inside a transaction; 0 rows → `409 POOL_CAPACITY_EXCEEDED`, full rollback ([architecture.md](architecture.md) §7).
- Validation: DB `CHECK (seats_taken <= seat_capacity)` as backstop.
- Acceptance: Nusrat and Shirin racing for the last seat → exactly one `201`, one `409`, final `seats_taken = capacity`, exactly one new `ACTIVE` membership; 100-run loop passes 100/100.

**FR-POOL-005 — Seat release on cancellation.** Cancelling a member frees exactly their held seats in the same transaction; empty pool → `CANCELLED`.

- Acceptance: `seats_taken` after cancel = sum of remaining `ACTIVE` memberships; invariant holds under a concurrent join (one blocks on the row lock, both serialize correctly).

**FR-RIDE-001 — Ride state machine.** Only the transitions in [PRD §8](PRD.md) are legal; every transition is a conditional update on the expected current status.

- Acceptance: exhaustive unit test of the transition matrix: every legal pair accepted, every illegal pair → `409 ILLEGAL_STATE_TRANSITION`, terminal states (`COMPLETED`, `CANCELLED`) accept nothing.

**FR-RIDE-002 — Status history.** Every transition of a ride _and_ its pool writes a `ride_status_history` row (entity, from → to, actor, reason, timestamp).

- Acceptance: a completed trip yields a contiguous trail `—→REQUESTED→ACCEPTED→DRIVER_ARRIVED→STARTED→COMPLETED` for each active member and matching pool rows; cancelled member's trail ends at `CANCELLED`.

## 7. Functional Requirements — Geography & Matching

**FR-GEO-001 — Zone catalog.** `GET /zones` returns exactly the eight Dhaka zones (Banani, Gulshan, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara).

- Precondition: seed ran (idempotent). Acceptance: 8 rows, stable ids, public endpoint; re-seeding doesn't duplicate.

**FR-GEO-002 — Deterministic distance.** Distance for any ordered zone pair comes from `zone_distances` (integer km, symmetric, 28 pairs); pickup ≠ destination.

- Validation: unknown zone → `400 ZONE_NOT_FOUND`; equal zones → `400 SAME_ZONE` (before any distance lookup — no `(x,x)` row exists).
- Acceptance: Banani→Dhanmondi and Dhanmondi→Banani both return **7**; the value never depends on time, load, or external services.

## 8. Functional Requirements — Fare & Payment

**FR-FARE-001 — Estimate before requesting.** `POST /fare/estimate` returns the full breakdown (`distanceKm`, `baseFarePoisha`, `distanceChargePoisha`, `subtotalPoisha`, `estimatedDiscountPoisha`, `perSeatPoisha`, `totalDuePoisha`, `assumesPoolSize`).

- Acceptance: Banani→Dhanmondi, 1 seat → `14400 / 2880 / 11520`; the response **also** carries `seatCapacity` and `poolAvailableSeats` (remaining seats in the corridor's `OPEN` pool — or the full capacity when no pool exists yet) so the request form can cap the seat picker instead of letting the passenger submit into a guaranteed `409`; same input → byte-identical output (pure function).

**FR-FARE-002 — Individual final fare at completion.** On pool completion, each active member gets `FINAL` fare: discount applied **iff ≥ 2 active members complete**; `totalDue = perSeat × seats`.

- Acceptance: Nusrat and Rafiq each finalize at `11520`; a member who cancelled first has no final fare; solo completion finalizes at `14400`.

**FR-FARE-003 — Integer money.** Every monetary value stored/transferred as integer poisha; no floats/doubles anywhere in the money path.

- Acceptance: DB columns are `INTEGER` with `CHECK >= 0`; API sends `*Poisha` integers; a grep for floating-point fare math fails review.

**FR-FARE-004 — Determinism & immutability.** The rate card is one module (`config/rate-card.ts`); clients can never submit amounts; final fares are written once (ESTIMATED → FINAL) in the completion transaction.

- Acceptance: altering request body with `totalPoisha` fields is ignored (and rejected as unknown fields by Zod strict mode).

**FR-PAYMENT-001 — Payment created at completion.** One `PENDING` payment per active member, `amount_poisha` = final fare, `method = SIMULATED`.

- Acceptance: exactly one row per ride (UNIQUE); amount equals the fare row by construction.

**FR-PAYMENT-002 — Simulate payment.** Owner-only `PENDING → PAID` with `paid_at`; idempotent; impossible before `COMPLETED`.

- Acceptance: repeat returns `PAID` with same id; foreign ride → `404`; early payment → `409`.

## 9. Functional Requirements — History

**FR-HISTORY-001 — Passenger ride history.** `GET /rides` (optionally `?status=COMPLETED`) returns the caller's rides, newest first, paginated, each with corridor, dates, status, seats, final/estimated fare, payment status.

- Acceptance: only own rides; stable pagination (no duplicates/skips across pages); completed ride detail remains fully viewable (timeline + fare + payment).

**FR-HISTORY-002 — Driver ride history.** `GET /driver/pools?status=COMPLETED` returns the driver's completed pools with roster and per-member fares/totals.

- Acceptance: only pools of the driver's own vehicle; cancelled pools remain queryable (`?status=CANCELLED`) with full trail; no hard deletes.

## 10. Non-Functional Requirements

Targets are deliberately realistic for a free-tier, single-instance MVP — each explains _why_ the number is what it is.

| ID             | Category           | Requirement                                                                                                                                                                                                          |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-001    | Security           | Passwords bcrypt (cost ≥ 12); two-token JWT scheme (15 min access in memory, 7 d rotating refresh cookie); secrets env-only — [security.md](security.md)                                                             |
| NFR-SEC-002    | Security           | Role + ownership checks on **every** endpoint; enforced in services, verified by the full authz matrix (testing §5)                                                                                                  |
| NFR-SEC-003    | Security           | No secrets/PII in git, logs, or client responses; emails never returned for other users; rate limiting on auth routes                                                                                                |
| NFR-SEC-004    | Security/Privacy   | PII minimization: rosters show first name + status only; no location/phone/card data exists in the system at all                                                                                                     |
| NFR-CONC-001   | Data integrity     | Capacity invariant holds under concurrent joins: 100/100 race runs, 0 overbooks (Goal G2)                                                                                                                            |
| NFR-PERF-001   | Performance        | Ride/pool API p95 < **300 ms** at MVP load (≤ 50 concurrent users, single instance). _Why:_ demo-sized traffic on one free-tier container; a bigger number would be fiction — scale triggers live in architecture §9 |
| NFR-REL-001    | Reliability        | Every multi-row operation is transactional — no observable partial state; process restarts lose nothing (all state in Postgres)                                                                                      |
| NFR-DATA-001   | Data integrity     | Referential integrity via NOT NULL FKs + constraints; schema rejects invalid rows even if application code is wrong (database §9)                                                                                    |
| NFR-DATA-002   | Data integrity     | All money as integer poisha end-to-end; identical inputs always produce identical fares (regression sentinel: `11520`)                                                                                               |
| NFR-MAINT-001  | Maintainability    | Controller→Service→Repository layering, TypeScript strict, one validation library, docs/ as source of truth, ADRs for decisions                                                                                      |
| NFR-SCAL-001   | Scalability        | Stateless API (JWT) + indexed hot queries so horizontal scaling needs no redesign; documented path for 1M/100k (architecture §9)                                                                                     |
| NFR-AVAIL-001  | Availability       | **Honest:** free tiers offer no SLA (Render can restart/spin down). Mitigations: health checks + container restart policy, idempotent writes, deploy rollback documented; RTO/RPO not promised                       |
| NFR-USAB-001   | Usability          | All flows completable at 375 px width; keyboard-reachable; loading/empty/error/disabled/unauthorized states defined for every screen (ui-ux §5)                                                                      |
| NFR-OBS-001    | Observability      | Structured JSON logs with request ids + `/health` + `/health/ready`; every 4xx/5xx carries a stable error code correlating to logs                                                                                   |
| NFR-DEPLOY-001 | Deploy portability | Clean clone + `docker compose up` = running system with migrations + seed (Goal G1); identical images usable in production                                                                                           |
| NFR-DEPLOY-002 | Cost               | **Zero paid infrastructure**; every free-tier claim verified with a dated source (deployment §2)                                                                                                                     |

## 11. Change control

Requirements change only through this file first, then dependent docs (order: [PRD](PRD.md) → this file → [architecture](architecture.md)/[api](api.md)/[ui-ux](ui-ux.md) → [testing](testing.md) → [todo](../todo.md)), then code. The [traceability matrix](traceability.md) is updated in the same change — a requirement without a matrix row does not exist.
