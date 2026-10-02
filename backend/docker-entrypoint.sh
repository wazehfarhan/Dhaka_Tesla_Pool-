#!/bin/sh
# Container entrypoint (deployment.md §1): migrate, seed, then serve.
#
# Both steps are idempotent, which is what makes `docker compose up` safe to
# re-run: `migrate deploy` applies only the committed migrations that have not
# run yet, and the seed skips rows that already exist (Phase 2, PRD §2).
#
# `set -e` matters: if the migration fails we must NOT start a server against a
# schema the code does not expect. A loud crash beats a silent half-migrated DB.
#
# No `prisma generate` here: the image build runs it (backend/Dockerfile) and
# the runtime stage copies the result into src/generated, so the client is
# already on disk. Generating again would only add a step to every start.
set -e

# Prisma 7 finds its config (`prisma7.config.ts`, which owns the datasource URL
# and the seed command) relative to the working directory, so the CLI runs from
# `backend/` exactly as it does under `npm run … --workspace backend`.
cd /app/backend

echo "→ prisma migrate deploy"
npx prisma migrate deploy

echo "→ prisma db seed"
npx prisma db seed

cd /app
echo "→ starting API"
exec "$@"
