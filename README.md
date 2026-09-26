# Dhaka Tesla Pool (MVP)

Ride-pooling MVP for Dhaka: several passengers share **one Tesla** along a corridor. Each
passenger keeps an **individual seat, status and fare**, and the car's fixed seat capacity is
enforced atomically — two passengers racing for the last seat can never both win.

> **Status:** Phase 1 complete (repository scaffold). Application code beyond the health
> route lands in Phases 2–16 — see [todo.md](todo.md). Documentation is the source of truth:
> [docs/](docs/).

## The cast

| Actor | Who | Role in the demo |
|---|---|---|
| **Jashim** | Driver | Goes online, accepts pools, arrives, starts, completes |
| **Bullet** | Tesla (`DHK-TSL-001`, **3 seats**) | The car whose capacity is never exceeded |
| **Nusrat** | Passenger | Requests Banani → Dhanmondi, pays ৳115.20 sim |
| **Rafiq** | Passenger | Same corridor → joins Nusrat's pool |
| **Shirin** | Passenger | Fills the last seat; races Nusrat in the concurrency test |

## Stack

```text
Frontend   Next.js (App Router) + TypeScript + Tailwind CSS
Backend    Node.js + Express 5 + TypeScript + Zod
Database   PostgreSQL + Prisma                    (Phase 2)
Auth       JWT access (in memory) + refresh cookie (Phase 3)
Testing    Vitest + Supertest · Playwright         (Phases 3+, 11)
Container  Docker Compose                          (Phase 12)
```

Pinned today: Node ≥ 22 (developed on 24), TypeScript 5.9 (**not** 7.x — `typescript-eslint`
requires `< 6.1`), ESLint 9 (flat config) repo-wide — see the note in
[docs/tech-stack.md](docs/tech-stack.md) §8 — and Tailwind 4 (CSS-first).

## Quickstart (local dev)

```bash
cp .env.example .env          # defaults are dev-only and validated at boot
npm install                   # installs both workspaces
npm run dev:api               # API on :4000
npm run dev:web               # web on :3000
curl http://localhost:4000/api/v1/health
```

`docker compose up` arrives in Phase 12 and will be the one-command path for reviewers.

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint across both workspaces |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm test` | Vitest (unit + integration) |
| `npm run format` | Prettier |

## Documentation

| Document | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product, cast, lifecycle, geography, fare model, demo script, MVP scope |
| [docs/requirements.md](docs/requirements.md) | Functional + non-functional requirements with acceptance criteria |
| [docs/architecture.md](docs/architecture.md) | Layers, pool flow, **concurrency proof**, "If Oi Tesla Goes Viral", ADRs |
| [docs/database.md](docs/database.md) | Tables, constraints as invariants, ERD, integer-poisha money |
| [docs/api.md](docs/api.md) | REST contract, error registry, idempotency, pagination |
| [docs/ui-ux.md](docs/ui-ux.md) | Pages, flows, UI states, components |
| [docs/security.md](docs/security.md) | AuthN/AuthZ, validation, threats, `.env` rules |
| [docs/testing.md](docs/testing.md) | Unit → integration → authorization → **concurrency** → E2E |
| [docs/deployment.md](docs/deployment.md) | `docker compose`, verified free tiers, rollback |
| [docs/traceability.md](docs/traceability.md) | Matrix, gap analysis, assumptions, open decisions |

## Branch & commit conventions

`feature/*` → `main` → `pre-release` → `release/vX.Y.Z` (tag). Commits use
`<type>(<scope>): <description>` with `feat|fix|refactor|test|docs|chore|build`.

## AI usage

This section is completed in Phase 14 with the **actual** project history — the tools used,
what they were used for, one accepted suggestion and one rejected/modified suggestion with the
reason it changed. It is deliberately left unpopulated until then rather than invented.

## Licence

MIT — see [LICENSE](LICENSE).
