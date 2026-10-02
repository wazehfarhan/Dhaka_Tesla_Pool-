#!/usr/bin/env bash
# Vercel build (vercel.json → buildCommand): migrate, then build the frontend.
#
# Serverless has no long-lived entrypoint, so `migrate deploy` cannot run at
# container start the way docker-entrypoint.sh does it for Compose — it runs
# here, once per deployment, before Next builds.
#
# Database URL resolution: the Neon Vercel integration injects several names
# (`DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`…). We accept the first
# one set and export it as `DATABASE_URL`, which is what prisma7.config.ts and
# the seed read. Failing loudly here beats a cryptic Prisma error later.
set -euo pipefail

resolve_db_url() {
  for name in DATABASE_URL POSTGRES_URL POSTGRES_PRISMA_URL NEON_DATABASE_URL; do
    value="${!name:-}"
    if [ -n "$value" ]; then
      echo "$value"
      return 0
    fi
  done
  return 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  if resolved="$(resolve_db_url)"; then
    export DATABASE_URL="$resolved"
    echo "→ using database URL from Neon integration"
  else
    echo "ERROR: no database URL found." >&2
    echo "Add Neon Postgres via Vercel Storage, or set DATABASE_URL." >&2
    exit 1
  fi
fi

# Prisma needs the DIRECT (non-pooled) URL for migrations; the pooled one is
# for runtime queries. If the integration exposes one, prefer it here.
for name in POSTGRES_URL_NON_POOLING NEON_DIRECT_URL DIRECT_URL; do
  value="${!name:-}"
  if [ -n "$value" ]; then
    export DATABASE_URL="$value"
    echo "→ using direct database URL for migrations"
    break
  fi
done

cd backend
npx prisma migrate deploy
# The generated client is gitignored (backend/src/generated/), so a fresh clone
# — Vercel, CI, a reviewer's machine — has no client.js for tsx to resolve
# until this runs. Same config, same custom output path (../src/generated/prisma
# per schema.prisma); must precede the seed AND the frontend build, because
# api/index.ts transitively imports ../backend/src/generated/prisma/client.js.
npx prisma generate
# The seed is idempotent (reference zones/distances only in production — no
# demo passwords), so re-running on every deploy is safe.
npx prisma db seed
cd ..

npm run build --workspace frontend
