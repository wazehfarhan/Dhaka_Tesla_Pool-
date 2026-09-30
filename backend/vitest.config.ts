import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * The default suite is database-free and fast: every test runs against the
     * in-memory fake (tests/helpers/fake-database). The concurrency suite needs a
     * real Postgres and has its own config — `npm run test:concurrency` — so it
     * is excluded here rather than failing on a missing DATABASE_URL_TEST.
     * (The defaults are replaced by this list, hence the explicit node_modules.)
     */
    exclude: ['tests/concurrency/**', 'node_modules/**', 'dist/**'],
    // Test-only networking shim: supertest dials ephemeral test servers at
    // `[::1]` instead of 127.0.0.1, so a foreign IPv4 listener that co-binds
    // our dual-stack wildcard port can never answer — IPv6-loopback dials only
    // reach IPv6 sockets — see tests/setup-loopback.ts for the probe data.
    setupFiles: ['tests/setup-loopback.ts'],
    // Integration tests against a real Postgres arrive in Phase 3+ and read
    // DATABASE_URL_TEST from the environment (.env.example).
    env: { NODE_ENV: 'test' },
    // bcrypt cost 12 (security.md §1) makes register/login suites CPU-bound;
    // under file-level parallelism the default 5s ceiling trips purely from
    // scheduling contention, not from a hung request. 20s tolerates a fully
    // saturated runner while still failing genuinely stuck tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
