/**
 * Global setup for the concurrency suite (testing.md §6).
 *
 * Two jobs, both of which must fail loudly rather than skip quietly:
 * 1. require `DATABASE_URL_TEST` — the suite is meaningless against a missing DB;
 * 2. apply the committed migrations to that database, so a fresh checkout needs
 *    no manual `prisma migrate deploy` step before the race can run.
 *
 * `prisma migrate deploy` (never `db push`) is used for the same reason the
 * entrypoint uses it: the tests must exercise the schema that ships.
 */

import { execFileSync } from 'node:child_process';
import { loadDotEnv } from '../../src/config/load-env.js';

export default function setup(): void {
  loadDotEnv();
  const url = process.env['DATABASE_URL_TEST'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL_TEST is not set.\n' +
        'The concurrency suite needs a real Postgres — that is the point of it (testing.md §6).\n' +
        'Either: docker compose up -d db, or copy .env.example to .env and point the\n' +
        'variable at a throwaway database. See README → Testing.',
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    // The CLI reads prisma7.config.ts, which takes its URL from DATABASE_URL.
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
