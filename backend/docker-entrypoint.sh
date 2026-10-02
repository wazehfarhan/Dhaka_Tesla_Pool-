#!/bin/sh
# Container entrypoint (deployment.md §1): migrate, seed, then serve.
#
# Both steps are idempotent, which is what makes `docker compose up` safe to
# re-run: `migrate deploy` applies only the committed migrations that have not
# run yet, and the seed skips rows that already exist (Phase 2, PRD §2).
#
# `set -e` matters: if the migration fails we must NOT start a server against a
# schema the code does not expect. A loud crash beats a silent half-migrated DB.
set -e

# Prisma 7 finds its config (`prisma7.config.ts`, which owns the datasource URL
# and the seed command) relative to the working directory, so the CLI runs from
# `backend/` exactly as it does under `npm run … --workspace backend`.
cd /app/backend

echo "→ prisma migrate deploy"
npx prisma migrate deploy

# The generated client is gitignored, so a fresh image has no client.js for
# tsx to resolve until this runs (same fix as scripts/vercel-build.sh).
echo "→ prisma generate"
npx prisma generate

echo "→ prisma db seed"
npx prisma db seed

cd /app
echo "→ starting API"
exec "$@"
