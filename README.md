# Dhaka Tesla Pool (MVP)

Ride-pooling MVP for Dhaka: several passengers share **one Tesla** along a corridor. Each
passenger keeps an **individual seat, status and fare**, and the car's fixed seat capacity is
enforced atomically — two passengers racing for the last seat can never both win.

> **Status:** the MVP runs end to end. `docker compose up --build` gives you the API, the web
> app and a migrated, seeded database; `./scripts/smoke.sh` then drives the whole demo against it
> (22 assertions, including the one-seat race). 157 unit/integration tests plus a 100-iteration
> concurrency suite run against a real Postgres. What remains — deploying to live URLs and
> recording the demo video — needs accounts a human must create: see [todo.md](todo.md).

## The cast

| Actor      | Who                                | Role in the demo                                          |
| ---------- | ---------------------------------- | --------------------------------------------------------- |
| **Jashim** | Driver                             | Goes online, accepts pools, arrives, starts, completes    |
| **Bullet** | Tesla (`DHK-TSL-001`, **3 seats**) | The car whose capacity is never exceeded                  |
| **Nusrat** | Passenger                          | Requests Banani → Dhanmondi, pays ৳115.20 sim             |
| **Rafiq**  | Passenger                          | Same corridor → joins Nusrat's pool                       |
| **Shirin** | Passenger                          | Fills the last seat; races Nusrat in the concurrency test |

## Stack

```text
Frontend   Next.js 16 (App Router) + TypeScript + Tailwind 4
Backend    Node.js 22 + Express 5 + TypeScript + Zod
Database   PostgreSQL 16 + Prisma 7 (driver adapter, Rust-free client)
Auth       JWT access token in memory + rotating httpOnly refresh cookie
Testing    Vitest + Supertest (database-free) · Vitest + real Postgres (concurrency)
Infra      Docker Compose · GitHub Actions
```

Pinned because the latest majors break the toolchain: TypeScript 5.9 (`typescript-eslint`
requires `< 6.1`) and ESLint 9 repo-wide — see [docs/tech-stack.md](docs/tech-stack.md) §8.

## Quickstart — Docker (the one-command path)

```bash
cp .env.example .env          # dev-only defaults, validated at boot
docker compose up --build     # db → api → web
```

Open **http://localhost:3000**, then in a second terminal:

```bash
./scripts/smoke.sh            # the documented demo, end to end, with assertions
```

`db` (Postgres 16) reports healthy before `api` starts; the API's entrypoint runs
`prisma migrate deploy && prisma db seed` and then serves on **:4000**. In `NODE_ENV=production`
the seed writes reference data only (zones and distances), so no default passwords can ever
reach a deployed database — the demo cast registers through the UI.

Start over from an empty database with `docker compose down -v`.

## Quickstart — local development

```bash
cp .env.example .env
npm install
docker compose up -d db       # or any Postgres — DATABASE_URL points at it
npm run dev:api               # API on :4000
npm run dev:web               # web on :3000
```

## Scripts

| Command                                        | What it does                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint`                                 | ESLint across both workspaces                                              |
| `npm run typecheck`                            | `tsc --noEmit` across both workspaces                                      |
| `npm test`                                     | Vitest — unit + integration, **no database needed** (157 tests)            |
| `npm run test:concurrency --workspace backend` | The seat race against a real Postgres (100 iterations + constraint proofs) |
| `npm run build`                                | `tsc` (API) and `next build` (web)                                         |
| `npm run format` / `format:check`              | Prettier                                                                   |
| `./scripts/smoke.sh`                           | The end-to-end demo against a running stack                                |
| `./scripts/flake-audit.sh 10`                  | Run the default suite ten times; fail on the first flake                   |

The concurrency suite needs `DATABASE_URL_TEST` pointing at a throwaway database, and it
**refuses to run** against a missing one — a race test that quietly skips proves nothing:

```bash
docker compose up -d db
docker compose exec db psql -U app -d dhaka_tesla_pool -c 'CREATE DATABASE dhaka_tesla_pool_test;'
DATABASE_URL_TEST=postgresql://app:app_password@localhost:5432/dhaka_tesla_pool_test \
  npm run test:concurrency --workspace backend
```

## What the tests actually prove

| Suite                                                     | Proves                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fare` · `matching` · `capacity` · `state-machine` (pure) | The rate card byte-for-byte (`14400 → 2880 → 11520`), the five matching conditions, the capacity boundary, and the whole state graph including both refusals — `RIDE_ALREADY_STARTED` vs `ILLEGAL_STATE_TRANSITION` |
| `auth` · `health` · `errors`                              | Registration/login/refresh rotation, the error registry, the health contracts                                                                                                                                       |
| `ride-create`                                             | The demo request, pooling into one pool, idempotent replay, every documented `400`/`409`, the 401/403 matrix                                                                                                        |
| `driver-flow`                                             | The whole trip: queue → detail → accept → arrive → start → complete, `FINAL` fares, `PENDING` payments, the `409 {current, expected}` envelope, and driver pool cancel                                              |
| `cancellation`                                            | Pre-start cancels, seats freed atomically, the last member cancelling the pool (`POOL_EMPTY`), the payment lifecycle — with the seat invariant asserted after every scenario                                        |
| `vehicles`                                                | The garage, duplicate-plate `409`, and `ONLINE` gating new requests                                                                                                                                                 |
| `concurrency` (**real Postgres**)                         | 100 × "one seat, two claimants, one winner", plus the CHECK, partial-unique and ledger constraints refusing a raw bypass                                                                                            |

## Architecture in one paragraph

One rule shapes everything: **the database is the only authority.** A ride request is validated,
matched to a corridor pool, and then _claims its seat with a single conditional `UPDATE`_
inside one transaction — `WHERE status = 'OPEN' AND seats_taken + n <= seat_capacity`. Under
Postgres' row lock the losing writer's `WHERE` is re-evaluated and matches zero rows, which the
API turns into `409 POOL_CAPACITY_EXCEEDED`. The same shape governs every state transition: a
status-gated `UPDATE` whose row count decides between "applied" and
`409 ILLEGAL_STATE_TRANSITION`. Fare finalization, payment creation, seat release and history rows
all commit inside that same transaction, so a half-applied trip is not representable. See
[docs/architecture.md](docs/architecture.md) §6–§7 and [docs/database.md](docs/database.md) §9.

## Environment

Every value is documented in [.env.example](.env.example) and validated when the API boots
([docs/security.md](docs/security.md) §6) — a missing or too-short JWT secret fails the boot loudly
rather than at first use.

| Variable                                   | Purpose                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Postgres connection (Compose builds its own from `POSTGRES_*`)                                                  |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥ 32 characters each — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGIN`                              | Comma-separated allowed origins                                                                                 |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_MAX_AUTH`   | Request ceilings (defaults 100/min, 10/min — security.md §5)                                                    |
| `NEXT_PUBLIC_API_URL`                      | Inlined into the web bundle **at build time**; changing it needs `docker compose build web`                     |

## Migrations & seed

```bash
npm run prisma:migrate --workspace backend   # apply committed migrations
npm run prisma:seed --workspace backend      # idempotent: zones, 28 distances, demo cast
```

Deploy paths always use `migrate deploy`, never `db push`.

## API at a glance

The full contract is [docs/api.md](docs/api.md); the error registry, pagination and idempotency
rules live there too. Errors always answer
`{"success": false, "error": {"code", "message", "details?"}}`, and a resource that exists but is
not the caller's is a **404, never a 403**, so ids cannot be probed.

| Method                   | Path                                                      | Role                                       |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `POST`                   | `/auth/register` · `/login` · `/refresh` · `/logout`      | public                                     |
| `GET`                    | `/auth/me`                                                | any                                        |
| `GET`                    | `/zones`                                                  | public                                     |
| `POST`                   | `/fare/estimate`                                          | PASSENGER                                  |
| `POST` · `GET`           | `/rides`                                                  | PASSENGER (idempotent create; own history) |
| `GET`                    | `/rides/:id`                                              | PASSENGER (owner-scoped)                   |
| `POST`                   | `/rides/:id/cancel`                                       | PASSENGER (pre-start)                      |
| `GET` · `POST`           | `/rides/:id/payment` · `/payment/simulate`                | PASSENGER                                  |
| `GET`                    | `/driver/pools` · `/driver/pools/:id`                     | DRIVER                                     |
| `POST`                   | `/driver/pools/:id/{accept,arrive,start,complete,cancel}` | DRIVER                                     |
| `GET` · `POST` · `PATCH` | `/vehicles` · `/vehicles/:id`                             | DRIVER                                     |
| `GET`                    | `/health` · `/health/ready`                               | public                                     |

## Documentation

| Document                                     | Contents                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/PRD.md](docs/PRD.md)                   | Product, cast, lifecycle, geography, fare model, demo script, MVP scope  |
| [docs/requirements.md](docs/requirements.md) | Functional + non-functional requirements with acceptance criteria        |
| [docs/architecture.md](docs/architecture.md) | Layers, pool flow, **concurrency proof**, "If Oi Tesla Goes Viral", ADRs |
| [docs/database.md](docs/database.md)         | Tables, constraints as invariants, ERD, integer-poisha money             |
| [docs/api.md](docs/api.md)                   | REST contract, error registry, idempotency, pagination                   |
| [docs/ui-ux.md](docs/ui-ux.md)               | Pages, flows, UI states, components                                      |
| [docs/security.md](docs/security.md)         | AuthN/AuthZ, validation, threats, `.env` rules                           |
| [docs/testing.md](docs/testing.md)           | Unit → integration → authorization → **concurrency** → E2E               |
| [docs/deployment.md](docs/deployment.md)     | `docker compose`, verified free tiers, rollback                          |
| [docs/traceability.md](docs/traceability.md) | Matrix, gap analysis, assumptions, open decisions                        |

## Branch & commit conventions

`feature/*` → `main` → `pre-release` → `release/vX.Y.Z` (tag). Commits use
`<type>(<scope>): <description>` with `feat|fix|refactor|test|docs|chore|build`.

## AI usage

This project was built with an AI coding assistant (Cline, driving Claude) working from
[docs/](docs/) as the specification and [todo.md](todo.md) as the plan.

**What it was used for:** the API, the tests, the Docker/Compose stack, the CI workflow and this
documentation — and for running the gates (lint, typecheck, tests, the live smoke test) after each
phase. The design decisions were already written down in [docs/](docs/) before any code existed,
which is what kept the output consistent with a contract nobody had to reverse-engineer after the
fact.

**One suggestion accepted — the concurrency suite runs against a real Postgres.** The suggestion
was to simulate the seat race with the in-memory fake the other tests use. That was tried and
rejected: the first 100-iteration run failed at iteration 51, not from a lost seat but from our own
`100 req/min` rate limiter answering `429` — which is indistinguishable, from the test's point of
view, from a lost race. The accepted resolution was twofold: a documented `RATE_LIMIT_MAX` knob
(the limiter stays real; only its ceiling becomes tunable, which is also what an operator would
want) and a separate Vitest config that runs the race against a real database. It is green 100/100
and additionally proves the CHECK constraint, the partial unique index and the seat-ledger UNIQUE
refuse a raw bypass.

**One suggestion modified — the state machine became its own pure module.** The driver transition
table was first written as a `switch` inside the service. It was moved to
`driver.transitions.ts` with a `decideTransition()` function so it could be unit-tested without
HTTP or a database, and so the frontend could mirror the same table when deciding which action
button to enable. The original placement would have left the same rule living in two files with no
shared source of truth — and the UI would have offered a button the API refuses.

**What the AI did not decide:** the fare maths, the ownership/404 policy, the seat-accounting
invariant, the state machine and the cancellation rules all come from [docs/](docs/). The code
implements them; the tests assert them.

## Licence

MIT — see [LICENSE](LICENSE).
