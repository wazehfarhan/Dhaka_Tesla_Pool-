# ── deps ──────────────────────────────────────────────────────────────────────
# Workspace install from the repo root (same reason as the API image: Next is
# hoisted, and the build context must contain the whole workspace).
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace frontend --include-workspace-root

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY frontend ./frontend

# NEXT_PUBLIC_* values are inlined at build time, so the API URL has to be here,
# not at runtime (deployment.md §1; the frontend's .env.example says the same).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Same build-time rule for the demo-cast buttons on /login (see docker-compose.yml).
ARG NEXT_PUBLIC_DEMO_ACCOUNTS=0
ENV NEXT_PUBLIC_DEMO_ACCOUNTS=$NEXT_PUBLIC_DEMO_ACCOUNTS
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace frontend

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl

# `output: 'standalone'` emits a self-contained server with only the modules it
# traced (frontend/next.config.ts) — the node_modules copies are unnecessary.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

USER node
EXPOSE 3000
# /login, not /: the root route redirects, which would fail a strict 200 probe
# (deployment.md §1).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "frontend/server.js"]
