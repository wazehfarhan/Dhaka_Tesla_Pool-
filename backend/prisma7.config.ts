// Prisma 7 configuration. In v7 the datasource URL lives here (schema.prisma has no `url`),
// and the CLI is pointed at the same environment the API uses.
//
// We deliberately do NOT install dotenv: `loadDotEnv` is our dependency-free loader that reads
// the repo-root `.env` first (see src/config/load-env.ts), so `prisma migrate` and the API can
// never disagree about which database they are talking to.
import { defineConfig } from 'prisma/config';
import { loadDotEnv } from './src/config/load-env.js';

loadDotEnv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
