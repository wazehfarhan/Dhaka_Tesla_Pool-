import { defineConfig } from 'vitest/config';

/**
 * The concurrency suite runs against a **real** Postgres (testing.md §6) because
 * the thing under test *is* the database's behaviour under contention: the
 * conditional-UPDATE row lock, EvalPlanQual's re-check of the `WHERE`, and the
 * partial unique index. Mocks cannot exercise any of that, so this config is
 * separate from the default suite, which stays database-free and fast.
 *
 * Run it with:  npm run test:concurrency   (needs DATABASE_URL_TEST, or a
 * `docker compose up db` plus the URL from .env.example)
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/concurrency/**/*.test.ts'],
    setupFiles: ['tests/setup-loopback.ts'],
    // A race that legitimately waits on a row lock needs room; the per-test
    // timeout is set explicitly on the long test as well.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One worker: the suite measures real lock contention, and running files
    // in parallel would add noise the assertions do not model.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    globalSetup: ['tests/concurrency/global-setup.ts'],
    env: { NODE_ENV: 'test' },
  },
});
