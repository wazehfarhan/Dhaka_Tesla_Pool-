import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTokenService } from '../../src/modules/auth/token.service.js';
import { createDatabase, type Database } from '../../src/db/client.js';
import { createLogger } from '../../src/shared/logger.js';
import { hash } from 'bcryptjs';
import { loadDotEnv } from '../../src/config/load-env.js';

/**
 * The brief's headline scenario (testing.md §6, Goal G2): **one seat left, two
 * passengers claim it at the same instant.**
 *
 * This suite runs against a real Postgres because the thing under test *is* the
 * database's behaviour: the conditional `UPDATE … WHERE seats_taken + n <=
 * seat_capacity` under a row lock, Postgres' EvalPlanQual re-check of that
 * `WHERE` for the blocked second writer, and the partial unique index on the
 * corridor pool. A fake or a mock can only re-assert the code we wrote; this
 * asserts that Postgres agrees.
 *
 * Every iteration re-seeds the fixture (no cleanup between runs, so a stale row
 * from a previous iteration can never make a later one pass), and each iteration
 * asserts the same four invariants:
 *   1. exactly one `201`,
 *   2. exactly one clean `409 POOL_CAPACITY_EXCEEDED`,
 *   3. `seats_taken` = 3 afterwards — never 4,
 *   4. exactly three `ACTIVE` memberships and the loser persisted nothing.
 *
 * `CONCURRENCY_ITERATIONS` overrides the default 100 for a quick local run; CI
 * leaves it at the full count (todo.md Phase 9: zero tolerance for flakes).
 */

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
  /**
   * The rate limiter is real here — only its ceiling is raised. The suite fires
   * 2 requests per iteration (200+ in a few seconds) on purpose, and a `429`
   * from our own middleware is indistinguishable from a lost seat race: both
   * arrive as "no winner" (security.md §5, RATE_LIMIT_MAX).
   */
  RATE_LIMIT_MAX: 1_000_000,
  RATE_LIMIT_MAX_AUTH: 100_000,
};

const tokens = createTokenService(env);

/** Goal G2 is 100 runs; the override exists only to keep a local edit loop short. */
const ITERATIONS = Number(process.env['CONCURRENCY_ITERATIONS'] ?? 100);

const BANANI = 1;
const DHANMONDI = 4;

let database: Database;
let app: Express;

/** A user row plus a real access token (the credential exchange is auth.test.ts's job). */
async function seedUser(
  name: string,
  email: string,
  role: 'PASSENGER' | 'DRIVER',
): Promise<{ token: string; id: string }> {
  const id = randomUUID();
  await database.prisma.user.create({
    data: { id, name, email, role, passwordHash: await hash('test-only-password', 4) },
  });
  return { id, token: tokens.signAccessToken({ sub: id, role }) };
}

/**
 * Wipe every table in FK order, then build the fixture the scenario needs:
 * Bullet with 3 seats, two passengers already holding seats on a Banani →
 * Dhanmondi pool, and `seats_taken = 2` — exactly **one seat free**.
 */
async function seedOneSeatLeft(): Promise<{
  poolId: string;
  nusrat: { token: string; id: string };
  shirin: { token: string; id: string };
}> {
  await database.prisma.$executeRawUnsafe(
    'TRUNCATE ride_status_history, payments, fares, pool_members, ride_requests, pools, vehicles, refresh_tokens, users, zone_distances, zones RESTART IDENTITY CASCADE',
  );

  await database.prisma.zone.createMany({
    data: [
      { id: BANANI, name: 'Banani' },
      { id: DHANMONDI, name: 'Dhanmondi' },
    ],
  });
  // CHECK (zone_a < zone_b) — the table stores the ordered pair (database.md §3.2).
  await database.prisma.zoneDistance.create({
    data: { zoneA: BANANI, zoneB: DHANMONDI, distanceKm: 7 },
  });

  const driver = await seedUser('Jashim', `jashim-${randomUUID()}@example.com`, 'DRIVER');
  const rafiq = await seedUser('Rafiq', `rafiq-${randomUUID()}@example.com`, 'PASSENGER');
  const mehjabin = await seedUser('Mehjabin', `mehjabin-${randomUUID()}@example.com`, 'PASSENGER');
  const nusrat = await seedUser('Nusrat', `nusrat-${randomUUID()}@example.com`, 'PASSENGER');
  const shirin = await seedUser('Shirin', `shirin-${randomUUID()}@example.com`, 'PASSENGER');

  const vehicle = await database.prisma.vehicle.create({
    data: {
      ownerId: driver.id,
      model: 'Tesla Model 3',
      plate: `DHK-${randomUUID().slice(0, 8)}`,
      seatCapacity: 3,
      status: 'ONLINE',
    },
  });

  const pool = await database.prisma.pool.create({
    data: {
      driverId: driver.id,
      vehicleId: vehicle.id,
      pickupZoneId: BANANI,
      destinationZoneId: DHANMONDI,
      seatCapacity: 3,
      seatsTaken: 2, // two ACTIVE members below — the invariant holds by construction
      status: 'OPEN',
    },
  });

  for (const passenger of [rafiq, mehjabin]) {
    const ride = await database.prisma.rideRequest.create({
      data: {
        passengerId: passenger.id,
        poolId: pool.id,
        pickupZoneId: BANANI,
        destinationZoneId: DHANMONDI,
        seats: 1,
        status: 'REQUESTED',
      },
    });
    await database.prisma.poolMember.create({
      data: { poolId: pool.id, rideRequestId: ride.id, seats: 1, status: 'ACTIVE' },
    });
  }

  return { poolId: pool.id, nusrat, shirin };
}

beforeAll(async () => {
  loadDotEnv();
  const url = process.env['DATABASE_URL_TEST'];
  if (url === undefined || url === '') {
    // The global setup already fails loudly on this; this is the type guard.
    throw new Error('DATABASE_URL_TEST is required for the concurrency suite.');
  }
  database = createDatabase(url);
  // Boot the real app against the real database — the HTTP layer, the auth
  // middleware and the transactional orchestration all run for real.
  app = createApp({ env, logger, database });
});

afterAll(async () => {
  await database?.close();
});

describe(`last-seat race — ${ITERATIONS} iterations (testing.md §6, FR-POOL-004)`, () => {
  it('gives the last seat to exactly one of two simultaneous claimants, every time', async () => {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      const { poolId, nusrat, shirin } = await seedOneSeatLeft();

      // Both requests are launched in the same tick: the first to reach the
      // conditional UPDATE holds the row lock, the second is re-checked by
      // EvalPlanQual and must find its WHERE false.
      const [a, b] = await Promise.all([
        request(app)
          .post('/api/v1/rides')
          .set('Authorization', `Bearer ${nusrat.token}`)
          .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 }),
        request(app)
          .post('/api/v1/rides')
          .set('Authorization', `Bearer ${shirin.token}`)
          .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 }),
      ]);

      const created = [a, b].filter((res) => res.status === 201);
      const rejected = [a, b].filter(
        (res) => res.status === 409 && res.body?.error?.code === 'POOL_CAPACITY_EXCEEDED',
      );

      expect(created.length, `iteration ${iteration}: exactly one winner`).toBe(1);
      expect(rejected.length, `iteration ${iteration}: exactly one clean rejection`).toBe(1);

      // The pool the winner joined is the one both tried to join.
      expect(created[0]?.body.data.poolId).toBe(poolId);

      // The ledger, read straight from the database — the money question.
      const pool = await database.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
      expect(pool.seatsTaken, `iteration ${iteration}: seats_taken must be 3, never 4`).toBe(3);
      expect(pool.status).toBe('OPEN');

      const activeMembers = await database.prisma.poolMember.count({
        where: { poolId, status: 'ACTIVE' },
      });
      expect(activeMembers, `iteration ${iteration}: no phantom membership`).toBe(3);

      // Exactly one of the two passengers exists in the database at all, and the
      // other persisted nothing — the loser's transaction rolled back whole.
      const nusratRides = await database.prisma.rideRequest.count({
        where: { passengerId: nusrat.id },
      });
      const shirinRides = await database.prisma.rideRequest.count({
        where: { passengerId: shirin.id },
      });
      expect(nusratRides + shirinRides, `iteration ${iteration}: one ride persisted`).toBe(1);
      expect([nusratRides, shirinRides].filter((count) => count === 0)).toHaveLength(1);

      const loserId = nusratRides === 1 ? shirin.id : nusrat.id;
      const loserFares = await database.prisma.fare.count({
        where: { rideRequest: { passengerId: loserId } },
      });
      expect(loserFares, `iteration ${iteration}: the loser persisted no fare`).toBe(0);
    }
  });
});

/**
 * Defense in depth (testing.md §6, database.md §9): the application layer above
 * is not the only thing standing between a bug and an overbooked car. These
 * tests bypass the code entirely and ask Postgres directly, proving the schema
 * itself refuses the states the application is supposed to prevent.
 */
describe('the database refuses what the application is supposed to prevent', () => {
  it('rejects a raw overbooking UPDATE with the CHECK constraint (never seats_taken > capacity)', async () => {
    const { poolId } = await seedOneSeatLeft();

    // A direct bypass of every application rule — exactly what database.md §9
    // promises the CHECK will catch.
    await expect(
      database.prisma.$executeRawUnsafe(`UPDATE pools SET seats_taken = 4 WHERE id = '${poolId}'`),
    ).rejects.toThrow(/pools_seats_taken_check|violates check constraint/i);

    // And the row is untouched: a failed statement changes nothing.
    const pool = await database.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.seatsTaken).toBe(2);
  });

  it('rejects a second OPEN pool on the same corridor (partial unique index)', async () => {
    const { poolId } = await seedOneSeatLeft();
    const original = await database.prisma.pool.findUniqueOrThrow({ where: { id: poolId } });

    // `idx_unique_open_pool_per_corridor` is partial: it only covers OPEN pools,
    // which is what lets the driver re-open a corridor after a trip ends.
    await expect(
      database.prisma.pool.create({
        data: {
          driverId: original.driverId,
          vehicleId: original.vehicleId,
          pickupZoneId: BANANI,
          destinationZoneId: DHANMONDI,
          seatCapacity: 3,
        },
      }),
    ).rejects.toThrow(/unique|idx_unique_open_pool_per_corridor/i);

    // The index is partial, so a CANCELLED pool on the same corridor is fine.
    const cancelled = await database.prisma.pool.create({
      data: {
        driverId: original.driverId,
        vehicleId: original.vehicleId,
        pickupZoneId: BANANI,
        destinationZoneId: DHANMONDI,
        seatCapacity: 3,
        status: 'CANCELLED',
      },
    });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects a duplicate seat ledger entry for the same ride (UNIQUE ride_request_id)', async () => {
    await seedOneSeatLeft();
    const member = await database.prisma.poolMember.findFirstOrThrow({});

    await expect(
      database.prisma.poolMember.create({
        data: { poolId: member.poolId, rideRequestId: member.rideRequestId, seats: 1 },
      }),
    ).rejects.toThrow(/unique/i);
  });
});
