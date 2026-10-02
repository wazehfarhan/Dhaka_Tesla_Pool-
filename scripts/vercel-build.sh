#!/usr/bin/env bash
# Vercel build (vercel.json → buildCommand): migrate, then build the frontend.
#
# Serverless has no long-lived entrypoint, so `migrate deploy` cannot run at
# container start the way docker-entrypoint.sh does it for Compose — it runs
# here, once per deployment, before Next builds. The seed is idempotent
# (reference zones/distances only in production — no demo passwords), so
# re-running on every deploy is safe. `prisma db seed` needs DATABASE_URL and
# tsx, both present because Vercel installs devDependencies for the build.
set -euo pipefail

cd backend
npx prisma migrate deploy
npx prisma db seed
cd ..

npm run build --workspace frontend
