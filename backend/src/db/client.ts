import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Database client factory — the single place a PrismaClient is constructed
 * (architecture.md §4: repositories own Prisma; nothing else imports it directly).
 *
 * Prisma 7 is the Rust-free client and therefore needs a driver adapter; `pg` supplies the
 * pool. The URL always comes from validated configuration, never from ambient process state.
 */
export interface Database {
  /** Readiness probe used by GET /api/v1/health/ready. */
  ping(): Promise<void>;
  /** Close database connections during shutdown. */
  close(): Promise<void>;
  /** Escape hatch for repositories and integration tests. */
  readonly prisma: PrismaClient;
}

export function createDatabase(databaseUrl: string): Database {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    async ping(): Promise<void> {
      await prisma.$queryRaw`SELECT 1`;
    },
    async close(): Promise<void> {
      await prisma.$disconnect();
    },
  };
}
