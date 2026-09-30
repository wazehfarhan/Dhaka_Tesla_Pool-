# ── deps ──────────────────────────────────────────────────────────────────────
# The backend is an npm workspace, so its (hoisted) dependencies install from the
# repo root. The build context is therefore the repository root — compose passes
# `dockerfile: backend/Dockerfile` for exactly this reason.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# `npm ci` fails loudly if the lockfile drifts, which is what we want in a deploy
# path. Dev dependencies are kept in the runtime image on purpose: the entrypoint
# runs `prisma migrate deploy` and `prisma db seed` from this image
# (deployment.md §1), and both come from the dev toolchain. Trimming them would
# mean moving Prisma's CLI into a second, version-coupled image — a trade a
# reviewer should make deliberately, not one this MVP should make silently.
RUN npm ci --workspace backend --include-workspace-root

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY backend ./backend

# No `prisma generate` here: the generated client is committed under
# src/generated (Phase 2) and `npm run typecheck` fails if the schema and the
# client ever drift, so CI is the guard. Generating again in an image build would
# add a network-dependent step for no gain.
RUN npm run build --workspace backend

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL is required by the pg driver's TLS negotiation on alpine images.
RUN apk add --no-cache openssl

# npm workspaces hoist: everything (including the backend's own deps) lands in
# /app/node_modules, and `backend/node_modules` may not exist at all — copying it
# unconditionally is what broke the first build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
# The seed runs from source through tsx (Prisma's configured seed command), so
# it imports the *source* generated client; the compiled API uses dist's copy.
# Both are the same committed output — src/generated (Phase 2).
COPY --from=build /app/backend/src/generated ./backend/src/generated
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/prisma7.config.ts ./backend/prisma7.config.ts
COPY --from=build /app/backend/src/config ./backend/src/config
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/package.json ./package.json
COPY backend/docker-entrypoint.sh ./backend/docker-entrypoint.sh

# Never run as root: a container escape should not start as uid 0.
USER node

EXPOSE 4000
# Liveness only — readiness (a real SELECT 1) is /api/v1/health/ready, and
# compose's db dependency is what actually gates traffic (deployment.md §1).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "./backend/docker-entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
