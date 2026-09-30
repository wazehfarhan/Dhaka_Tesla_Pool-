import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/modules/auth/token.service.js';
import { createLogger } from '../src/shared/logger.js';
import {
  createFakeDatabase,
  type FakeDatabase,
  type FakeUserRow,
} from './helpers/fake-database.js';

/**
 * Phase 8 cancellation + payments suite (todo.md) — api.md §5.4, §6.5 (the
 * driver side lives in `driver-flow.test.ts`) and §8, against PRD §14.
 *
 *  - `POST /rides/:id/cancel`: the pre-start window (`REQUESTED`, `ACCEPTED`,
 *    `DRIVER_ARRIVED`), seats freed atomically, other members untouched, the
 *    last member out cancelling the pool (`POOL_EMPTY`), and the two refusals —
 *    `409 RIDE_ALREADY_STARTED` once under way, `409 ILLEGAL_STATE_TRANSITION`
 *    when already terminal, `404` for a foreign ride.
 *  - `GET /rides/:id/payment` + `POST /rides/:id/payment/simulate`: `PENDING →
 *    PAID`, idempotent on repeat, refused before the trip completes.
 *  - The seat invariant `seats_taken = Σ ACTIVE memberships` (database.md §5) is
 *    asserted directly after every scenario — that is Phase 8's DoD.
 *
 * Storage is faked; Express, middleware, Zod, services and the transactional
 * orchestration run for real. Users are seeded and tokens minted with the real
 * token service (bcrypt at cost 12 would dominate the runtime — see
 * `driver-flow.test.ts` for the reasoning).
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

const tokens = createTokenService(env);

/** Zone ids follow `prisma/seed.ts` (database.md §3.1). */
const BANANI = 1;
const GULSHAN = 2;
const DHANMONDI = 4;
const MIRPUR = 5;

interface TestUser {
  name: string;
  email: string;
  role: 'PASSENGER' | 'DRIVER';
}

const NUSRAT: TestUser = { name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' };
const RAFIQ: TestUser = { name: 'Rafiq', email: 'rafiq@example.com', role: 'PASSENGER' };
const SHIRIN: TestUser = { name: 'Shirin', email: 'shirin@example.com', role: 'PASSENGER' };
const JASHIM: TestUser = { name: 'Jashim', email: 'jashim@example.com', role: 'DRIVER' };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The demo geography plus Bullet, 3 fixed seats (D-02), ONLINE (database.md §3.1). */
function seedGeography(database: FakeDatabase): void {
  const zones: ReadonlyArray<readonly [number, string]> = [
    [BANANI, 'Banani'],
    [GULSHAN, 'Gulshan'],
    [3, 'Mohakhali'],
    [DHANMONDI, 'Dhanmondi'],
    [MIRPUR, 'Mirpur'],
  ];
  for (const [id, name] of zones) database.zones.set(id, { id, name });
  for (const [zoneA, zoneB, distanceKm] of [
    [BANANI, DHANMONDI, 7],
    [BANANI, MIRPUR, 10],
  ] as const) {
    database.zoneDistances.set(`${zoneA}:${zoneB}`, { zoneA, zoneB, distanceKm });
  }
  database.vehicles.set('veh_bullet', {
    id: 'veh_bullet',
    ownerId: 'u_unassigned',
    model: 'Tesla Model 3',
    plate: 'DHK-TSL-001',
    seatCapacity: 3,
    status: 'ONLINE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

interface Seeded {
  token: string;
  userId: string;
}

function seedUser(database: FakeDatabase, user: TestUser): Seeded {
  const now = new Date();
  const row: FakeUserRow = {
    id: randomUUID(),
    name: user.name,
    email: user.email,
    passwordHash: 'seeded-by-test-fixture',
    role: user.role,
    createdAt: now,
    updatedAt: now,
  };
  database.users.set(row.id, row);
  return { token: tokens.signAccessToken({ sub: row.id, role: row.role }), userId: row.id };
}

interface Fixture {
  app: Express;
  database: FakeDatabase;
  driver: Seeded;
  nusrat: Seeded;
  rafiq: Seeded;
  shirin: Seeded;
  poolId: string;
  /**
   * Ride ids for the riders actually in the pool — `arrange(1)` creates only
   * Nusrat's, so `rafiq`/`shirin` are absent there (asserted before use).
   */
  rides: { nusrat: string; rafiq?: string; shirin?: string };
}

/** Fail loudly rather than returning a sentinel id that would 404 later. */
function failFixture(what: string): never {
  throw new Error(`fixture: ${what} missing`);
}

/**
 * Arrange the Phase 4 setup the cancellation rules are written against: Jashim's
 * Bullet ONLINE, then the requested number of passengers on the demo corridor
 * (Banani → Dhanmondi, 7 km) so they all share one pool.
 */
async function arrange(riders: 1 | 2 = 2): Promise<Fixture> {
  const database = createFakeDatabase();
  seedGeography(database);
  const app = createApp({ env, logger, database });

  const driver = seedUser(database, JASHIM);
  const nusrat = seedUser(database, NUSRAT);
  const rafiq = seedUser(database, RAFIQ);
  const shirin = seedUser(database, SHIRIN);

  const bullet = database.vehicles.get('veh_bullet');
  if (!bullet) throw new Error('fixture: vehicle missing');
  database.vehicles.set('veh_bullet', { ...bullet, ownerId: driver.userId });

  for (const rider of [nusrat, rafiq].slice(0, riders)) {
    const created = await request(app)
      .post('/api/v1/rides')
      .set(auth(rider.token))
      .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 });
    expect(
      created.status,
      `ride create failed (${created.status}): ${JSON.stringify(created.body)}`,
    ).toBe(201);
  }

  const pool = [...database.pools.values()][0];
  if (!pool) throw new Error('fixture: pool missing');
  const rideOf = (userId: string): string | undefined =>
    [...database.rideRequests.values()].find((row) => row.passengerId === userId)?.id;

  return {
    app,
    database,
    driver,
    nusrat,
    rafiq,
    shirin,
    poolId: pool.id,
    rides: {
      nusrat: rideOf(nusrat.userId) ?? failFixture('Nusrat ride'),
      rafiq: rideOf(rafiq.userId),
      shirin: undefined,
    },
  };
}

/** Drive the driver through the given progression actions, asserting each `200`. */
async function advance(
  app: Express,
  poolId: string,
  token: string,
  actions: readonly string[],
): Promise<void> {
  for (const action of actions) {
    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/${action}`)
      .set(auth(token));
    expect(res.status, action).toBe(200);
  }
}

/** Drive the pool all the way to COMPLETED — the state payments exist in. */
async function completeTrip(fixture: Fixture): Promise<void> {
  await advance(fixture.app, fixture.poolId, fixture.driver.token, [
    'accept',
    'arrive',
    'start',
    'complete',
  ]);
}

/**
 * The database's own seat invariant (database.md §5):
 * `pools.seats_taken = Σ pool_members.seats WHERE status = 'ACTIVE'`.
 * Phase 8's DoD is that this holds after *every* scenario, so it is asserted
 * rather than assumed.
 */
function expectSeatInvariant(fixture: Fixture): void {
  const pool = fixture.database.pools.get(fixture.poolId);
  if (!pool) throw new Error('fixture: pool missing');
  const activeSeats = [...fixture.database.poolMembers.values()]
    .filter((member) => member.poolId === fixture.poolId && member.status === 'ACTIVE')
    .reduce((sum, member) => sum + member.seats, 0);
  expect(pool.seatsTaken, 'seats_taken must equal the sum of ACTIVE memberships').toBe(activeSeats);
}

describe('POST /api/v1/rides/:id/cancel — the passenger’s pre-start exit (api.md §5.4, PRD §14)', () => {
  it('cancels a REQUESTED ride, frees its seat, and leaves the other member untouched', async () => {
    const fixture = await arrange(2);
    const { app, database, nusrat, poolId, rides } = fixture;
    const rafiqRide = rides.rafiq;
    if (rafiqRide === undefined) throw new Error('fixture: Rafiq should be in the pool');

    // Ownership scope is checked before any state talk: never 403 (api.md §1).
    const foreign = await request(app)
      .post(`/api/v1/rides/${rafiqRide}/cancel`)
      .set(auth(nusrat.token))
      .send({});
    expect(foreign.status).toBe(404);

    const cancelled = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(nusrat.token))
      .send({ reason: 'Change of plans' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      id: rides.nusrat,
      status: 'CANCELLED',
      poolId,
      // Rafiq is still waiting, so the pool survives.
      poolStatus: 'OPEN',
      seats: 1,
      reason: 'Change of plans',
    });

    // Rafiq's ride, seat and status are exactly as before (PRD §14).
    expect(database.rideRequests.get(rafiqRide)?.status).toBe('REQUESTED');
    expect(database.pools.get(poolId)).toMatchObject({ status: 'OPEN', seatsTaken: 1 });
    expectSeatInvariant(fixture);

    // The membership is cancelled with a timestamp, and the seat came back.
    const member = [...database.poolMembers.values()].find(
      (row) => row.rideRequestId === rides.nusrat,
    );
    expect(member?.status).toBe('CANCELLED');
    expect(member?.cancelledAt).not.toBeNull();

    // A cancelled ride is never charged: fare stays ESTIMATED, no payment (A-07).
    expect([...database.fares.values()].map((fare) => fare.status)).toEqual([
      'ESTIMATED',
      'ESTIMATED',
    ]);
    expect(database.payments.size).toBe(0);

    // And it is auditable (PRD §14: every cancellation writes a history row).
    const trail = [...database.statusHistory.values()].filter(
      (entry) => entry.entityId === rides.nusrat,
    );
    expect(trail.map((entry) => `${entry.fromStatus}→${entry.toStatus}`)).toEqual([
      'null→REQUESTED',
      'REQUESTED→CANCELLED',
    ]);
    expect(trail[1]?.reason).toBe('PASSENGER_CANCELLED');
    expect(trail[1]?.changedBy).toBe(nusrat.userId);
  });

  it('frees the seat for someone else: the third passenger then joins the same pool', async () => {
    const fixture = await arrange(2);
    const { app, database, poolId, rides } = fixture;

    await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(fixture.nusrat.token))
      .send({});

    // Bullet seats 3 (D-02): with Nusrat gone, Shirin takes the freed seat.
    const joined = await request(app)
      .post('/api/v1/rides')
      .set(auth(fixture.shirin.token))
      .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 });

    expect(joined.status).toBe(201);
    expect(joined.body.data.poolId).toBe(poolId);
    expect(database.pools.get(poolId)).toMatchObject({ status: 'OPEN', seatsTaken: 2 });
    expectSeatInvariant(fixture);
  });

  it('cancels the pool when the last member leaves (reason POOL_EMPTY)', async () => {
    const fixture = await arrange(1); // Nusrat alone in the pool
    const { app, database, poolId, rides } = fixture;

    const res = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(fixture.nusrat.token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.poolStatus).toBe('CANCELLED');
    expect(database.pools.get(poolId)).toMatchObject({ status: 'CANCELLED', seatsTaken: 0 });
    expectSeatInvariant(fixture);

    // Nobody chose this — the roster emptied, so the actor is NULL (system).
    const poolTrail = [...database.statusHistory.values()].find(
      (entry) => entry.entityType === 'POOL' && entry.toStatus === 'CANCELLED',
    );
    expect(poolTrail).toMatchObject({
      fromStatus: 'OPEN',
      reason: 'POOL_EMPTY',
      changedBy: null,
    });
  });
});

describe('POST /api/v1/rides/:id/cancel — refusals and the authorization matrix (api.md §1/§5.4)', () => {
  it('refuses with 409 RIDE_ALREADY_STARTED once the trip is under way', async () => {
    const fixture = await arrange(2);
    const { app, database, poolId, rides } = fixture;
    await advance(app, poolId, fixture.driver.token, ['accept', 'arrive', 'start']);

    const res = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(fixture.nusrat.token))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RIDE_ALREADY_STARTED');
    // The refused call persisted nothing (PRD §7 row 7: cancel button hidden).
    expect(database.rideRequests.get(rides.nusrat)?.status).toBe('STARTED');
    expect(database.pools.get(poolId)?.seatsTaken).toBe(2);
    expectSeatInvariant(fixture);
  });

  it('refuses a repeated cancel with 409 ILLEGAL_STATE_TRANSITION', async () => {
    const fixture = await arrange(2);
    const { app, rides } = fixture;

    const first = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(fixture.nusrat.token))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(fixture.nusrat.token))
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ILLEGAL_STATE_TRANSITION',
      details: { current: 'CANCELLED' },
    });
  });

  it('cancels from ACCEPTED and DRIVER_ARRIVED too — the whole pre-start window', async () => {
    for (const actions of [['accept'], ['accept', 'arrive']] as const) {
      const fixture = await arrange(2);
      await advance(fixture.app, fixture.poolId, fixture.driver.token, actions);

      const res = await request(fixture.app)
        .post(`/api/v1/rides/${fixture.rides.nusrat}/cancel`)
        .set(auth(fixture.nusrat.token))
        .send({});

      expect(res.status, actions.join('→')).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expectSeatInvariant(fixture);
    }
  });

  it('404s a foreign ride and an unknown id, 400s a malformed id (no ID probing)', async () => {
    const fixture = await arrange(2);
    const { app, nusrat, rides } = fixture;
    const rafiqRide = rides.rafiq;
    if (rafiqRide === undefined) throw new Error('fixture: Rafiq should be in the pool');

    const foreign = await request(app)
      .post(`/api/v1/rides/${rafiqRide}/cancel`)
      .set(auth(nusrat.token))
      .send({});
    expect(foreign.status).toBe(404);

    const unknown = await request(app)
      .post('/api/v1/rides/3b1a2c4d-1111-4222-8333-444455556666/cancel')
      .set(auth(nusrat.token))
      .send({});
    expect(unknown.status).toBe(404);

    const malformed = await request(app)
      .post('/api/v1/rides/not-a-uuid/cancel')
      .set(auth(nusrat.token))
      .send({});
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('401s without a token and 403s a driver (api.md §1, testing.md §5)', async () => {
    const fixture = await arrange(2);
    const { app, driver, rides } = fixture;

    const anonymous = await request(app).post(`/api/v1/rides/${rides.nusrat}/cancel`).send({});
    expect(anonymous.status).toBe(401);

    const asDriver = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(driver.token))
      .send({});
    expect(asDriver.status).toBe(403);
    expect(asDriver.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unknown body field with 400 VALIDATION_ERROR', async () => {
    const fixture = await arrange(2);
    const { app, nusrat, rides } = fixture;

    const res = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/cancel`)
      .set(auth(nusrat.token))
      .send({ status: 'CANCELLED' }); // clients never submit statuses

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /rides/:id/payment and POST /rides/:id/payment/simulate (api.md §8, PRD §13)', () => {
  it('404s the payment before the trip completes — nothing is fabricated', async () => {
    const fixture = await arrange(2);
    const { app, nusrat, rides } = fixture;

    const res = await request(app)
      .get(`/api/v1/rides/${rides.nusrat}/payment`)
      .set(auth(nusrat.token));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('409s a payment attempt before completion, naming the status it needs', async () => {
    const fixture = await arrange(2);
    const { app, nusrat, rides } = fixture;

    const res = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/payment/simulate`)
      .set(auth(nusrat.token))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'ILLEGAL_STATE_TRANSITION',
      details: { current: 'REQUESTED', expected: 'COMPLETED' },
    });
  });

  it('settles a PENDING payment and is idempotent on repeat', async () => {
    const fixture = await arrange(2);
    const { app, database, nusrat, rides } = fixture;
    await completeTrip(fixture);

    // The completion transaction already created the PENDING row (api.md §6.4).
    const pending = await request(app)
      .get(`/api/v1/rides/${rides.nusrat}/payment`)
      .set(auth(nusrat.token));
    expect(pending.status).toBe(200);
    expect(pending.body.data).toMatchObject({
      rideId: rides.nusrat,
      amountPoisha: 11_520, // 14400 − 2880 discount (PRD §12 demo numbers)
      currency: 'BDT',
      status: 'PENDING',
      method: 'SIMULATED',
      paidAt: null,
    });

    const first = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/payment/simulate`)
      .set(auth(nusrat.token))
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      id: pending.body.data.id,
      status: 'PAID',
      method: 'SIMULATED',
    });
    expect(first.body.data.paidAt).toEqual(expect.any(String));

    // Repeat returns the same PAID row — one payment per ride, forever (api.md §8).
    const second = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/payment/simulate`)
      .set(auth(nusrat.token))
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(database.payments.size).toBe(2); // one per member, not per attempt

    // The ride detail agrees with the payment endpoint (api.md §5.3).
    const detail = await request(app).get(`/api/v1/rides/${rides.nusrat}`).set(auth(nusrat.token));
    expect(detail.body.data.payment).toMatchObject({ status: 'PAID', amountPoisha: 11_520 });
  });

  it('404s a foreign ride and an unknown id on both payment routes (no ID probing)', async () => {
    const fixture = await arrange(2);
    const { app, nusrat, rafiq, rides } = fixture;
    const rafiqRide = rides.rafiq;
    if (rafiqRide === undefined) throw new Error('fixture: Rafiq should be in the pool');
    await completeTrip(fixture);

    for (const path of [
      `/api/v1/rides/${rafiqRide}/payment`,
      '/api/v1/rides/3b1a2c4d-1111-4222-8333-444455556666/payment',
    ]) {
      const read = await request(app).get(path).set(auth(nusrat.token));
      expect(read.status, path).toBe(404);
      const settle = await request(app).post(`${path}/simulate`).set(auth(nusrat.token)).send({});
      expect(settle.status, path).toBe(404);
    }

    // Rafiq's own payment is untouched by Nusrat's probing (ownership scope).
    const rafiqPayment = await request(app)
      .get(`/api/v1/rides/${rafiqRide}/payment`)
      .set(auth(rafiq.token));
    expect(rafiqPayment.body.data.status).toBe('PENDING');
  });

  it('401s without a token and 403s a driver', async () => {
    const fixture = await arrange(2);
    const { app, driver, rides } = fixture;

    const anonymousRead = await request(app).get(`/api/v1/rides/${rides.nusrat}/payment`);
    expect(anonymousRead.status).toBe(401);

    const anonymousSettle = await request(app)
      .post(`/api/v1/rides/${rides.nusrat}/payment/simulate`)
      .send({});
    expect(anonymousSettle.status).toBe(401);

    const asDriver = await request(app)
      .get(`/api/v1/rides/${rides.nusrat}/payment`)
      .set(auth(driver.token));
    expect(asDriver.status).toBe(403);
    expect(asDriver.body.error.code).toBe('FORBIDDEN');
  });
});
