// Express on Vercel — serverless entrypoint (deployment.md §2, "single project").
//
// Vercel's Express support is zero-config: a file under `api/` that default-
// exports the Express app becomes a Fluid-compute function. This file is the
// ONLY code that may touch `process.env` directly at module scope — every
// other module receives the validated `Env` object (architecture.md §8).
//
// What does NOT run here: `app.listen()` (Vercel owns the socket),
// `prisma migrate deploy` (runs in the build step via `scripts/vercel-build`),
// and the pretty logger transport (pino-pretty is a devDependency; production
// logs stay JSON for Vercel's log drains).
//
// Local development is unchanged: `npm run dev:api` still boots
// `backend/src/server.ts` with `listen(PORT)` against local Postgres.
import { createApp } from '../backend/src/app.js';
import { loadEnv } from '../backend/src/config/env.js';
import { createDatabase } from '../backend/src/db/client.js';
import { createLogger } from '../backend/src/shared/logger.js';

const env = loadEnv();
const logger = createLogger(env);
const database = createDatabase(env.DATABASE_URL);
const app = createApp({ env, logger, database });

export default app;
