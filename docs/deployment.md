# Deployment — Dhaka Tesla Pool (MVP)

Companion documents: [tech-stack](tech-stack.md) · [security](security.md) · [todo](../todo.md) · [traceability](traceability.md)

Brief constraints honored: **free/free-tier only, no paid infrastructure, Docker Compose first, `.env.example`, migrations, seed data, health checks.** Every pricing/free-tier statement below was verified against vendor documentation on **2026-09-26** (sources linked); re-verify before submission — free tiers change.

## 1. Local deployment (primary, required)

**Prerequisites:** Docker Desktop (or Docker Engine + Compose v2), git. No local Node/Postgres needed — everything runs in containers.

```bash
git clone https://github.com/wazehfarhan/Dhaka_Tesla_Pool-.git
cd Dhaka_Tesla_Pool-
cp .env.example .env          # defaults work for local dev
docker compose up --build
```

**What `docker compose up` does:**

| Service | Image / build                                                               | Detail                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`    | `postgres:16-alpine`                                                        | volume `pgdata`; healthcheck `pg_isready -U app`; env from `.env`                                                                                       |
| `api`   | `backend/` multi-stage Dockerfile (deps → build → `node:22-alpine` runtime) | **waits for `db` healthy**, then runs `prisma migrate deploy && prisma db seed && node dist/server.js`; healthcheck `GET /api/v1/health`                |
| `web`   | `frontend/` multi-stage Dockerfile (Next.js standalone output)              | healthcheck `GET /login` (**not `/`** — the root route redirects, which would fail a strict 200 check); `NEXT_PUBLIC_API_URL` → `http://localhost:4000` |

Then open `http://localhost:3000` (app) and `http://localhost:4000/api/v1/health` (API).

**Environment variables** — full list lives in `.env.example`, documented in [security.md](security.md) §6. The API validates them at boot (Zod) and refuses to start if a JWT secret or `DATABASE_URL` is missing — a bad deploy fails loudly, not mysteriously.

**Migrations:** `prisma migrate deploy` (applies committed migrations; never `db push` in deploy paths). **Seed:** idempotent — safe to re-run; creates the story cast (Jashim/Bullet, Nusrat, Rafiq, Shirin + Mehjabin for fixtures), the 8 zones, 28 zone distances, and the rate card; skips rows that exist. In `NODE_ENV=production` the seed creates **reference data only** (zones, distances, rate card) — demo users are registered through the UI instead.

**Health checks:** every compose service has a healthcheck; the API exposes `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (readiness: DB reachable) — the same endpoints are used by the cloud host.

## 2. Production (free tier, verified)

**Chosen topology — three free services:**

```text
Frontend  → Vercel Hobby
Backend   → Render (Free web service, Docker runtime)
Database  → Neon Free (Postgres)
```

### Verified free-tier facts (2026-09-26)

| Service                  | Plan                                         | Verified facts                                                                                                                                                                                                                                                                       | Source                                                             |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Vercel**               | Hobby — **free**                             | 100 GB data transfer, 1M edge requests/month; limits reset every 30 days; **Hobby restricts to non-commercial/personal use** — fine for an assessment project                                                                                                                        | [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby) |
| **Render**               | Free web service                             | Free instances exist; **spin down after inactivity → cold starts**; single instance only (no scaling beyond one), no persistent disks/SSH; monthly included usage caps shown in dashboard; Render states free instances are _not_ for production apps but are fine for hobby/preview | [render.com/docs/free](https://render.com/docs/free)               |
| **Neon**                 | Free — **$0, no time limit, no credit card** | 100 projects, **0.5 GB storage per project**, 100 CU-hours/month per project, autoscale to 2 CU, **scale-to-zero after ~5 min idle**                                                                                                                                                 | [neon.com/pricing](https://neon.com/pricing)                       |
| ~~Render Free Postgres~~ | **REJECTED**                                 | Free Render Postgres **expires 30 days after creation** (+14-day grace, then deleted), 1 GB, no backups — unacceptable for a demo that must stay alive                                                                                                                               | [render.com/docs/free](https://render.com/docs/free)               |

**Why this combination:** Vercel is the natural home for Next.js (zero-config build, instant rollbacks) and an MVP demo generates MBs against 100 GB. Render runs the _same Docker image_ we build for Compose — no re-platforming; cold starts (~30–60 s after idle) are acceptable for a reviewer clicking through once. Neon replaces Render Postgres specifically because of Render's 30-day DB expiry; its scale-to-zero suits an idle demo, 0.5 GB dwarfs this dataset (KBs), and `DATABASE_URL` is drop-in for Prisma.

**Deployment procedure:**

1. **DB:** create Neon free project → copy `DATABASE_URL`.
2. **API:** Render → New Web Service → Dockerfile from repo → env vars (`DATABASE_URL`, `JWT_*`, `CORS_ORIGIN` = Vercel URL, `NODE_ENV=production`) → health check path `/api/v1/health` → migrations run on deploy from the image entrypoint.
3. **Frontend:** Vercel → import repo → Next.js auto-detected → env `NEXT_PUBLIC_API_URL` = Render URL → deploy.
4. **Seed:** first deploy runs the idempotent seed (reference data only in production).
5. **Logs:** Render dashboard logs, Vercel function logs, Pino JSON on both.
6. **Rollback:** Vercel — one-click rollback to any previous deployment; Render — redeploy previous commit (clean git history makes this trivial); Neon — free-plan PITR window is limited, so schema changes are forward-only with reversible migration files.
7. **URLs (placeholders — replace after deploy, record in README):** frontend `https://dhaka-tesla-pool.vercel.app` · API `https://dhaka-tesla-pool-api.onrender.com` · health `…/api/v1/health`.

#### Vercel build: `output: 'standalone'` vs Vercel's build adapter

The Vercel project's **Root Directory is the repo root**, not `frontend/`, because `vercel.json`'s `buildCommand` (`npm run vercel-build`) must run `prisma migrate deploy && generate && db seed` and the workspace install from the root; `outputDirectory` then points at `frontend/.next`.

On Vercel, Next.js 16 does not call Vercel's wrapper the old way — Vercel injects its **build adapter** (`NEXT_ADAPTER_PATH` → `@vercel/next`'s `dist/adapter`), which Next runs *before* the `output: 'standalone'` post-processing (Next's own `build/index.js` notes standalone "might not be allowed if an adapter with onBuildComplete is configured"). The adapter writes `routes-manifest-deterministic.json` beside `routes-manifest.json` and registers it as a build-output asset; standalone handling then leaves it absent from `.next/`, so the deploy fails **after** "Build Completed" with:

```text
ENOENT: no such file or directory, lstat '/vercel/path0/frontend/.next/routes-manifest-deterministic.json'
```

Fix (`frontend/next.config.ts`): `output: process.env.VERCEL ? undefined : 'standalone'` — Vercel gets an ordinary build, while Docker (which never sets `VERCEL`) still receives the standalone server the image copies. Same failure family as [vercel/next.js#96646](https://github.com/vercel/next.js/issues/96646); the identifier can also come from a **multi-segment Root Directory** path bug dropping segments ([vercel/vercel#15937](https://github.com/vercel/vercel/issues/15937)).

### Production vs local differences

| Concern    | Local               | Production                                        |
| ---------- | ------------------- | ------------------------------------------------- |
| Seed       | full story cast     | reference data only (zones, distances, rate card) |
| Demo users | created by seed     | registered via `/auth/register`                   |
| Cookies    | `Secure` off (http) | `Secure` on (https at host)                       |
| Logs       | pretty/dev          | JSON, level `info`                                |

### Fallback — reproducible Docker deployment

If a free backend host is unsuitable at submission time (vendor policy change, cold-start complaints), the documented alternative is **the identical `docker compose up` on any Docker-capable VM** (including always-free VM offerings — _verify current terms yourself at the time of use; we claim no specific VM provider's limits here_): install Docker → clone → set `.env` with production secrets → `docker compose up -d --build` → reverse-proxy TLS (Caddy/Let's Encrypt) → same health endpoints. Fully reproducible from the repository alone — the brief's sanctioned "reproducible Docker deployment".

## 3. What we deliberately do NOT deploy

No Kubernetes, no managed message queues, no paid CDN contracts, no paid APM — none is required by the brief's MVP and each would violate the free-tier constraint. The scale-up story lives in [architecture.md](architecture.md) §9 with explicit triggers.
