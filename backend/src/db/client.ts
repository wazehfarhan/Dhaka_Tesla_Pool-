import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Database client factory — the single place a PrismaClient is constructed
 * (architecture.md §4: repositories own Prisma; nothing else imports it directly).
 *
 * Prisma 7 is the Rust-free client and therefore needs a driver adapter; `pg` supplies the
 * pool. The URL always comes from validated configuration, never from ambient process state.
 *
 * Serverless note (deployment.md §2): on Vercel each function instance builds its
 * own pool, so `DB_POOL_SIZE` stays small (default 2) — Neon's pooled endpoint
 * multiplexes those into few real Postgres connections. Local Docker keeps the
 * roomier default for the single long-lived API process.
 */
export interface Database {
  /** Readiness probe used by GET /api/v1/health/ready. */
  ping(): Promise<void>;
  /** Close database connections during shutdown. */
  close(): Promise<void>;
  /** Escape hatch for repositories and integration tests. */
  readonly prisma: PrismaClient;
}

export function createDatabase(databaseUrl: string, poolSize?: number): Database {
  const max = poolSize ?? Number(process.env['DB_POOL_SIZE'] ?? 5);
  const pool = new Pool({ connectionString: databaseUrl, max });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    async ping(): Promise<void> {
      await prisma.$queryRaw`SELECT 1`;
    },
    async close(): Promise<void> {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}
