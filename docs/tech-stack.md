# Tech Stack — Dhaka Tesla Pool (MVP)

Companion documents: [architecture](architecture.md) · [database](database.md) · [testing](testing.md) · [deployment](deployment.md) · [traceability](traceability.md)

For every non-mandated technology: **What · Purpose · Why selected · Alternatives · Why not · When we'd switch.** The brief mandates Frontend = React or Next.js, Backend = Node.js, Database = candidate's choice; everything else below is our pick.

## 0. The stack at a glance

```text
Frontend   Next.js (App Router) + TypeScript + Tailwind CSS
Backend    Node.js + Express + TypeScript + Zod
Database   PostgreSQL 16 + Prisma ORM
Auth       JWT — access token in memory (15 min) + refresh cookie (7 d, httpOnly)
Testing    Vitest + Supertest (integration) · Playwright (E2E)
Container  Docker + Docker Compose
Deploy     Vercel (frontend) + Render (API) + Neon (DB) — all free tier, verified
           fallback: docker compose on any Docker-capable host
```

## 1. Frontend framework — Next.js (App Router) + TypeScript

- **Purpose:** all pages, routing, rendering of passenger/driver flows.
- **Why selected:** the brief explicitly allows React *or* Next.js; Next.js gives file-based routing, a first-class TypeScript story, and a free hosting target (Vercel Hobby) that pairs with the brief's free-tier requirement. Authenticated dashboards are rendered as client components — this app is client-state driven after login.
- **Alternatives:** (a) Vite + React — lighter, but we'd hand-roll routing and lose the one-click free deploy; (b) Remix — solid, but smaller ecosystem familiarity for an evaluator.
- **Why not:** Vite's simplicity is real, but routing + deploy plumbing would end up reimplementing what Next.js ships.
- **Switch later if:** the app becomes a pure authenticated SPA with no public pages (→ Vite), or we need edge rendering at scale.

## 2. Backend framework — Express + TypeScript

- **Purpose:** REST API `/api/v1`, middleware pipeline, controllers.
- **Why selected:** the most widely known Node.js web framework — an evaluator can read it without learning a framework. It maps 1:1 onto the brief's suggested `Controller → Service → Repository` structure, and middleware ordering (CORS → helmet → rate limit → auth → routes → error handler) is explicit and easy to audit.
- **Alternatives:** (a) **Fastify** — faster and schema-first; genuinely better numbers, but less universally known and its plugin model adds a learning curve for reviewers; (b) **NestJS** — imposes layered structure via decorators/DI, but brings heavy abstraction (modules, guards, interceptors) that the brief's "engineering judgment over unnecessary complexity" discourates for an MVP.
- **Why not:** NestJS is over-engineering here (ADR-006); Fastify is a close second and the thin controller layer keeps a later swap contained to the HTTP layer.
- **Switch later if:** we need higher request throughput or schema-first validation across services (→ Fastify), or the codebase grows to dozens of modules needing enforced modularity (→ NestJS).

## 3. Database — PostgreSQL 16

- **Purpose:** system of record for users, pools, seats, fares, payments.
- **Why selected:** the MVP's core risks are *integrity* problems (overbooking, duplicate membership, invalid states), and Postgres gives us, for free: `CHECK`/`UNIQUE` constraints, partial unique indexes, row-level locking (`SELECT … FOR UPDATE`), atomic conditional `UPDATE … WHERE seats_taken + $n <= capacity`, and real transactions. It is also the DB behind most free managed tiers (Neon).
- **Alternatives:** (a) **MySQL 8** — adequate, but weaker ergonomics for partial indexes/`RETURNING` and historically lax `CHECK` enforcement; (b) **MongoDB** — no relational constraints or cheap row locks: the guarantees the brief tests would become application-only code; (c) **SQLite** — fine for a demo, but multi-writer concurrency (our headline test) is unreliable.
- **Switch later if:** practically never for this domain; sharding/replicas (architecture §9) extend it rather than replace it.
- **Open decision:** the brief lists DB as "candidate choice" — confirm **D-01** in [traceability.md](traceability.md).

## 4. ORM — Prisma

- **Purpose:** schema-as-code, migrations (`prisma migrate`), type-safe queries, seed script.
- **Why selected:** best-in-class DX and typing; migrations are a first-class workflow (brief requires migrations + seed); interactive transactions support the pooling flow. Critical detail: the atomic seat claim is written as **raw SQL inside `$transaction`** using **`$queryRaw` with `RETURNING`** (we must read the new `seats_taken` back; `$executeRaw` only returns an affected-row count): `UPDATE pools SET seats_taken = seats_taken + $n WHERE id = $1 AND status = 'OPEN' AND seats_taken + $n <= seat_capacity RETURNING seats_taken` — because Prisma's query builder cannot express column arithmetic in `WHERE`. See [architecture.md](architecture.md) §6–§7.
- **Alternatives:** (a) **Drizzle** — closer to SQL and lighter, smaller migration tooling ecosystem; (b) **TypeORM** — decorator-era API, weaker typing, friction with modern TS.
- **Switch later if:** we need SQL-level control everywhere (→ Drizzle or `pg` + SQL migrations).

## 5. Validation — Zod

- **Purpose:** request-body/query validation at the controller edge; env-var schema at boot (`server.ts` refuses to start on bad env); uniform `400 VALIDATION_ERROR` with field details.
- **Why selected:** one library for API inputs *and* environment config, inferred TypeScript types (no duplicated interfaces), tiny API surface.
- **Alternatives:** (a) **class-validator** — decorator/reflection-based, NestJS-flavoured; (b) **Joi** — mature but no inferred types; (c) Express JSON-schema plugins — fragmented.
- **Switch later if:** we adopt a schema-first framework (Fastify/OpenAPI codegen).

## 6. Authentication — JWT (access in memory + refresh httpOnly cookie)

### 6.1 Tokens & storage

Access JWT (`sub`, `role`, 15 min) returned in the body and held **in frontend memory only**; refresh JWT (7 d, `jti`) in an `httpOnly; SameSite=Lax; Secure` cookie scoped to `/api/v1/auth`. Rotation on every refresh; logout invalidates `jti`. Secrets: `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (independent, ≥ 32 chars, env-only, boot-time Zod check). Libraries: `jsonwebtoken` + `bcryptjs` (pure-JS bcrypt, no native build headaches in Docker).

**Why not sessions-in-DB:** stateless JWTs keep the API replica-friendly (see [architecture.md](architecture.md) §9) and avoid a store we'd have to operate; **why not next-auth:** it pulls its own data model/session semantics that fight a two-role custom API. Trade-off accepted: no server-side access-token revocation before expiry — mitigated by 15-min expiry + refresh rotation (full details: [security.md](security.md)).

## 7. Logging & observability

- **Pino** + `pino-http` for request logs; `pino-pretty` locally, raw JSON in production; one `requestId` across the whole request.
- Level via `LOG_LEVEL`; app-level domain events emitted for status changes and rejected seat claims.
- Health endpoints (`/health`, `/health/ready`) are the only "monitoring" the MVP needs; platform dashboards (Render/Vercel) cover the rest. OpenTelemetry is a scale-stage item ([architecture.md](architecture.md) §9), not MVP.

## 8. Testing (tooling choice)

| Tool | Role | Why it |
|---|---|---|
| **Vitest** | unit + integration runner | fastest modern Node runner, TS-native, Jest-compatible API (skills transfer), ESM-first — Jest still drags on ESM/TS config |
| **Supertest** | HTTP assertions | the standard for Express integration tests; boot the app in-process, no port juggling |
| **Playwright** | E2E | first-class Docker/CI story, auto-waiting, multi-browser; Cypress is a runner opinionated about SPA-only setups |

Rejected: Jest (config tax with modern ESM/TS), Cypress for E2E (heavier, browser-runner model fits our needs less), TestCafe (smaller ecosystem). Full strategy: [testing.md](testing.md).

**Linter pin (decision from Phase 1).** ESLint is pinned to **9.x repo-wide**, even though 10.x is current, because `eslint-config-next@16` pulls `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, which peer on ESLint `≤ 9`; mixing majors produced an incoherent install tree (hoisted 9 next to a workspace-local 10). One major, one flat-config style, zero invalid peers. Revisit when those plugins widen their peer ranges. Verified with `npm ls eslint`.

**TypeScript pin.** 5.9.3, not 7.x: `typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`. Revisit when the toolchain supports TS 7.

## 9. Containerization — Docker + Docker Compose

- Multi-stage builds: dependency layer → `tsc` build → minimal runtime (`node:22-alpine`); Next.js uses its **standalone** output to keep the image small.
- Compose orchestrates `db` (healthcheck `pg_isready`), `api` (waits for db healthy, then migrate → seed → start, healthcheck `/api/v1/health`), `web` (healthcheck `/`).
- Why Compose (not k8s/swarm): the brief mandates `docker compose up`; one-host, three containers is the correct size for this MVP.

## 10. Deployment

Vercel (frontend) + Render free web service (API, same Docker image) + Neon free Postgres, with a full `docker compose` VM fallback — every free-tier claim verified and sourced in [deployment.md](deployment.md). That document is authoritative for environment variables, migrations, seeds, health checks, logs, and rollback.

## 11. Technologies considered and rejected (summary)

| Technology | Why not (MVP) | Revisit when |
|---|---|---|
| Kafka / RabbitMQ / NATS | no async fan-out problem exists; brief prohibits unjustified tech | notifications/analytics create real decoupling needs |
| Redis | no shared cache/session/rate-limit store needed for 1 instance | multi-replica rate limiting or hot-read caching is measured |
| Kubernetes | orchestration cost with zero operational benefit at this size | a real multi-service ops team/scale appears |
| GraphQL | REST fits the fixed, few-client API; adds a whole layer of tooling | many heterogeneous clients need flexible joins |
| MongoDB | loses relational constraints/locks that our core guarantees rest on | never for this domain |
| Microservices | one bounded context (pooling) split across processes buys latency + failure modes | domain genuinely splits (e.g., billing as separate service) |
| Docker Swarm | Compose covers local + single-host deploy | multi-host needs appear |
| Tailwind UI kit / component library | hand-rolled ~15 components keep the bundle and story small | design complexity grows |

*(End of tech-stack; see [traceability.md](traceability.md) for open decision D-01: confirm PostgreSQL as the brief's "database candidate choice".)*