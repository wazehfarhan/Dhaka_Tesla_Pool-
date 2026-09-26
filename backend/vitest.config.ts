import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests against a real Postgres arrive in Phase 3+ and read
    // DATABASE_URL_TEST from the environment (.env.example).
    env: { NODE_ENV: 'test' },
  },
});
