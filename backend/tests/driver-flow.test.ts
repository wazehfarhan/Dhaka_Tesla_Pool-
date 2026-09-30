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
 * Phase 5 driver-flow suite (todo.md) — api.md §6 end to end:
 *
 *  - `GET /driver/pools`: the Requests queue / active trip / history endpoint
 *    (FR-HISTORY-002) with its documented filters, pagination meta and
 *    ownership scope.
 *  - `GET /driver/pools/:id`: roster (passenger, seats, per-ride status, fare,
 *    payment) + pool timeline.
 *  - `POST /driver/pools/:id/accept|arrive|start|complete`: the PRD §8
 *    progression, the `409 ILLEGAL_STATE_TRANSITION` envelope with
 *    `details: {current, expected}`, the foreign-pool `404`, and — on
 *    `complete` — fare finalization + `PENDING` payments in the same
 *    transaction (api.md §6.4, PRD §13).
 *  - the authorization matrix of testing.md §5 (401 / 403 on every route).
 *
 * Storage is faked (tests/helpers/fake-database); Express, middleware, Zod,
 * services and the transactional orchestration all run for real. Pools are
 * created the way production creates them — two passengers `POST /rides` the
 * same corridor while the driver's car is `ONLINE` — so the fixture exercises
 * matching, the seat claim and the driver flow together.
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

/** Zone ids follow `prisma/seed.ts` (database.md §3.1). */
const BANANI = 1;
const GULSHAN = 2;
const DHANMONDI = 4;
const MIRPUR = 5;

type TestRole = 'PASSENGER' | 'DRIVER';

interface TestUser {
  name: string;
  email: string;
  role: TestRole;
}

const NUSRAT: TestUser = { name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' };
const RAFIQ: TestUser = { name: 'Rafiq', email: 'rafiq@example.com', role: 'PASSENGER' };
const JASHIM: TestUser = { name: 'Jashim', email: 'jashim@example.com', role: 'DRIVER' };
const KAMAL: TestUser = { name: 'Kamal', email: 'kamal@example.com', role: 'DRIVER' };

/** The demo geography — Banani → Dhanmondi, 7 km (A-04, database.md §3.2). */
function seedGeography(database: FakeDatabase): void {
  const zones: ReadonlyArray<readonly [number, string]> = [
    [BANANI, 'Banani'],
    [GULSHAN, 'Gulshan'],
    [3, 'Mohakhali'],
    [DHANMONDI, 'Dhanmondi'],
    [MIRPUR, 'Mirpur'],
  ];
  for (const [id, name] of zones) database.zones.set(id, { id, name });
  const distances: ReadonlyArray<readonly [number, number, number]> = [
    [BANANI, DHANMONDI, 7],
    [BANANI, MIRPUR, 10],
  ];
  for (const [zoneA, zoneB, distanceKm] of distances) {
    database.zoneDistances.set(`${zoneA}:${zoneB}`, { zoneA, zoneB, distanceKm });
  }
  // Bullet — 3 fixed seats (D-02), ONLINE so `POST /rides` can match it.
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

/** The real token service — the fixture mints genuine access tokens (see `seedUser`). */
const tokens = createTokenService(env);

interface SeededUser {
  token: string;
  userId: string;
}

/**
 * Seed a user row and mint a real access token for it.
 *
 * The fixture deliberately skips `POST /auth/login`: bcrypt at cost 12
 * (security.md §1) costs ~430 ms per call, so signing in four users per test
 * would dominate the suite. The credential exchange is covered by
 * `auth.test.ts`; here the token is still issued and verified by the real token
 * service and the real `authenticate` middleware, and only storage is faked
 * (testing.md §4 — repositories are the seam).
 */
function seedUser(database: FakeDatabase, user: TestUser): SeededUser {
  const now = new Date();
  const row: FakeUserRow = {
    id: randomUUID(),
    name: user.name,
    email: user.email,
    // Never compared here: no endpoint in this suite reads the hash.
    passwordHash: 'seeded-by-test-fixture',
    role: user.role,
    createdAt: now,
    updatedAt: now,
  };
  database.users.set(row.id, row);
  return { token: tokens.signAccessToken({ sub: row.id, role: row.role }), userId: row.id };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Fixture {
  app: Express;
  database: FakeDatabase;
  driver: { token: string; userId: string };
  otherDriver: { token: string; userId: string };
  passengerToken: string;
  /** The shared corridor pool both passengers joined. */
  poolId: string;
  /** rideRequest ids keyed by passenger name — the fixture's stable handles. */
  rides: { nusrat: string; rafiq: string };
}

/**
 * Arrange the documented setup: two passengers pool on one corridor while
 * Jashim's car is ONLINE, leaving a 2/3 `OPEN` pool owned by Jashim.
 */
async function arrange(): Promise<Fixture> {
  const database = createFakeDatabase();
  seedGeography(database);
  const app = createApp({ env, logger, database });

  const nusrat = seedUser(database, NUSRAT);
  const rafiq = seedUser(database, RAFIQ);
  const driver = seedUser(database, JASHIM);
  const otherDriver = seedUser(database, KAMAL);

  // The pool's driver is the vehicle owner (database.md §3.5), so Bullet must
  // belong to Jashim *before* the rides are created.
  const bullet = database.vehicles.get('veh_bullet');
  if (!bullet) throw new Error('fixture: vehicle missing');
  database.vehicles.set('veh_bullet', { ...bullet, ownerId: driver.userId });

  for (const [token, seats] of [
    [nusrat.token, 1],
    [rafiq.token, 1],
  ] as const) {
    const created = await request(app)
      .post('/api/v1/rides')
      .set(auth(token))
      .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats });
    expect(
      created.status,
      `ride create failed (${created.status}): ${JSON.stringify(created.body)}`,
    ).toBe(201);
  }

  const pool = [...database.pools.values()][0];
  if (!pool) throw new Error('fixture: pool missing');
  const rideOf = (userId: string): string => {
    const ride = [...database.rideRequests.values()].find((row) => row.passengerId === userId);
    if (!ride) throw new Error('fixture: ride missing');
    return ride.id;
  };

  return {
    app,
    database,
    driver,
    otherDriver,
    passengerToken: nusrat.token,
    poolId: pool.id,
    rides: { nusrat: rideOf(nusrat.userId), rafiq: rideOf(rafiq.userId) },
  };
}

/** Every driver route (api.md §6) as `[method, path]` for the authorization matrix. */
function driverRoutes(poolId: string): ReadonlyArray<readonly ['get' | 'post', string]> {
  return [
    ['get', '/api/v1/driver/pools'],
    ['get', `/api/v1/driver/pools/${poolId}`],
    ['post', `/api/v1/driver/pools/${poolId}/accept`],
    ['post', `/api/v1/driver/pools/${poolId}/arrive`],
    ['post', `/api/v1/driver/pools/${poolId}/start`],
    ['post', `/api/v1/driver/pools/${poolId}/complete`],
  ];
}

describe('GET /api/v1/driver/pools — queue, active trip, history (api.md §6.1)', () => {
  it('lists the caller\u2019s pool with corridor names, distance, capacity and roster', async () => {
    const { app, driver, poolId } = await arrange();

    const res = await request(app).get('/api/v1/driver/pools').set(auth(driver.token));

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: poolId,
      status: 'OPEN',
      pickupZone: 'Banani',
      destinationZone: 'Dhanmondi',
      distanceKm: 7,
      seatsTaken: 2,
      seatCapacity: 3,
    });
    expect(res.body.data[0].members).toEqual([
      { passenger: 'Nusrat', seats: 1, status: 'REQUESTED' },
      { passenger: 'Rafiq', seats: 1, status: 'REQUESTED' },
    ]);
  });

  it('scopes the queue to the caller — another driver sees nothing', async () => {
    const { app, otherDriver } = await arrange();

    const res = await request(app).get('/api/v1/driver/pools').set(auth(otherDriver.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('serves the documented filters and treats an unknown status as an empty page', async () => {
    const { app, driver } = await arrange();

    const open = await request(app).get('/api/v1/driver/pools?status=OPEN').set(auth(driver.token));
    expect(open.status).toBe(200);
    expect(open.body.meta.total).toBe(1);

    // The same endpoint is the driver's history (FR-HISTORY-002).
    const completed = await request(app)
      .get('/api/v1/driver/pools?status=COMPLETED')
      .set(auth(driver.token));
    expect(completed.status).toBe(200);
    expect(completed.body.data).toEqual([]);

    // Lenient like GET /rides: an unrecognised status matches nothing, never 400.
    const nonsense = await request(app)
      .get('/api/v1/driver/pools?status=TELEPORTING')
      .set(auth(driver.token));
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.data).toEqual([]);
  });

  it('rejects impossible paging with 400 VALIDATION_ERROR', async () => {
    const { app, driver } = await arrange();

    for (const query of ['page=0', 'limit=101', 'limit=0']) {
      const res = await request(app).get(`/api/v1/driver/pools?${query}`).set(auth(driver.token));
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/driver/pools/:id — pool detail (api.md §6.2)', () => {
  it('returns the roster with ESTIMATED fares and no payment before pickup', async () => {
    const { app, driver, poolId, rides } = await arrange();

    const res = await request(app).get(`/api/v1/driver/pools/${poolId}`).set(auth(driver.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: poolId,
      status: 'OPEN',
      pickupZone: 'Banani',
      destinationZone: 'Dhanmondi',
      distanceKm: 7,
      seatsTaken: 2,
      seatCapacity: 3,
    });
    // The pool's timeline opens with its creation (POST /rides writes it).
    expect(res.body.data.timeline).toHaveLength(1);
    expect(res.body.data.timeline[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'OPEN',
      reason: 'POOL_CREATED',
    });
    expect(res.body.data.members).toEqual([
      {
        rideId: rides.nusrat,
        passenger: 'Nusrat',
        seats: 1,
        status: 'REQUESTED',
        fare: {
          status: 'ESTIMATED',
          subtotalPoisha: 14_400,
          poolDiscountPoisha: 2_880,
          totalPoisha: 11_520,
        },
        payment: null,
      },
      {
        rideId: rides.rafiq,
        passenger: 'Rafiq',
        seats: 1,
        status: 'REQUESTED',
        fare: {
          status: 'ESTIMATED',
          subtotalPoisha: 14_400,
          poolDiscountPoisha: 2_880,
          totalPoisha: 11_520,
        },
        payment: null,
      },
    ]);
  });

  it('404s a foreign pool and an unknown id, 400s a malformed id (no ID probing)', async () => {
    const { app, driver, otherDriver, poolId } = await arrange();

    const foreign = await request(app)
      .get(`/api/v1/driver/pools/${poolId}`)
      .set(auth(otherDriver.token));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');

    const unknown = await request(app)
      .get('/api/v1/driver/pools/6f1c1f4e-1111-4222-8333-444455556666')
      .set(auth(driver.token));
    expect(unknown.status).toBe(404);

    const malformed = await request(app)
      .get('/api/v1/driver/pools/not-a-uuid')
      .set(auth(driver.token));
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/driver/pools/:id/accept|arrive|start — the trip progression (api.md §6.3)', () => {
  it('accepts an OPEN pool, cascading ACCEPTED to every member and appending history', async () => {
    const { app, driver, database, poolId, rides } = await arrange();

    const res = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/accept`)
      .set(auth(driver.token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACCEPTED');
    expect(res.body.data.members).toEqual([
      {
        rideId: rides.nusrat,
        passenger: 'Nusrat',
        seats: 1,
        status: 'ACCEPTED',
        fare: {
          status: 'ESTIMATED',
          subtotalPoisha: 14_400,
          poolDiscountPoisha: 2_880,
          totalPoisha: 11_520,
        },
        // No payment exists until the trip completes (api.md §6.4).
        payment: null,
      },
      expect.objectContaining({ rideId: rides.rafiq, passenger: 'Rafiq', status: 'ACCEPTED' }),
    ]);

    // One transaction: the pool row, both rides and the trail all moved together.
    expect(database.pools.get(poolId)?.status).toBe('ACCEPTED');
    expect([...database.rideRequests.values()].map((ride) => ride.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
    ]);
    const poolTrail = [...database.statusHistory.values()].filter(
      (entry) => entry.entityType === 'POOL' && entry.toStatus === 'ACCEPTED',
    );
    expect(poolTrail).toHaveLength(1);
    expect(poolTrail[0]).toMatchObject({
      fromStatus: 'OPEN',
      reason: 'DRIVER_ACCEPTED',
      changedBy: driver.userId,
    });
    for (const ride of [rides.nusrat, rides.rafiq]) {
      const rideTrail = [...database.statusHistory.values()]
        .filter((entry) => entry.entityType === 'RIDE_REQUEST' && entry.entityId === ride)
        .map((entry) => `${entry.fromStatus ?? 'null'}→${entry.toStatus}`);
      // The ride's own creation, then the cascade from the driver's accept.
      expect(rideTrail).toEqual(['null→REQUESTED', 'REQUESTED→ACCEPTED']);
    }

    // And the detail endpoint renders the same trail (api.md §6.2).
    const detail = await request(app).get(`/api/v1/driver/pools/${poolId}`).set(auth(driver.token));
    expect(detail.body.data.status).toBe('ACCEPTED');
    expect(detail.body.data.timeline.map((entry: { toStatus: string }) => entry.toStatus)).toEqual([
      'OPEN',
      'ACCEPTED',
    ]);
  });

  it('refuses a repeated accept with 409 ILLEGAL_STATE_TRANSITION {current, expected}', async () => {
    const { app, driver, poolId } = await arrange();

    const first = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/accept`)
      .set(auth(driver.token));
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/accept`)
      .set(auth(driver.token));
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ILLEGAL_STATE_TRANSITION',
      details: { current: 'ACCEPTED', expected: 'OPEN' },
    });
  });

  it('refuses arrive, start and complete out of order, naming the status each needs', async () => {
    const { app, driver, database, poolId } = await arrange();

    const outOfOrder: ReadonlyArray<readonly [string, string]> = [
      ['arrive', 'ACCEPTED'],
      ['start', 'DRIVER_ARRIVED'],
      ['complete', 'STARTED'],
    ];
    for (const [action, expected] of outOfOrder) {
      const res = await request(app)
        .post(`/api/v1/driver/pools/${poolId}/${action}`)
        .set(auth(driver.token));
      expect(res.status, action).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_STATE_TRANSITION');
      expect(res.body.error.details).toEqual({ current: 'OPEN', expected });
    }

    // Nothing advanced and no trail was written by the refused calls.
    expect(database.pools.get(poolId)?.status).toBe('OPEN');
    const poolTrail = [...database.statusHistory.values()]
      .filter((entry) => entry.entityType === 'POOL')
      .map((entry) => entry.toStatus);
    expect(poolTrail).toEqual(['OPEN']);
  });

  it('walks arrive → start, keeping the roster and the history in step', async () => {
    const { app, driver, database, poolId, rides } = await arrange();

    await request(app).post(`/api/v1/driver/pools/${poolId}/accept`).set(auth(driver.token));
    const arrived = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/arrive`)
      .set(auth(driver.token));
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.status).toBe('DRIVER_ARRIVED');

    const started = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/start`)
      .set(auth(driver.token));
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('STARTED');
    expect(started.body.data.members.map((member: { status: string }) => member.status)).toEqual([
      'STARTED',
      'STARTED',
    ]);

    // Repeating start is refused, as is anything else once the trip is running.
    const repeat = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/start`)
      .set(auth(driver.token));
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.details).toEqual({ current: 'STARTED', expected: 'DRIVER_ARRIVED' });

    expect(database.pools.get(poolId)?.status).toBe('STARTED');
    for (const ride of [rides.nusrat, rides.rafiq]) {
      expect(database.rideRequests.get(ride)?.status).toBe('STARTED');
    }
    const poolReasons = [...database.statusHistory.values()]
      .filter((entry) => entry.entityType === 'POOL')
      .map((entry) => entry.reason);
    expect(poolReasons).toEqual([
      'POOL_CREATED',
      'DRIVER_ACCEPTED',
      'DRIVER_ARRIVED',
      'TRIP_STARTED',
    ]);
  });

  it('404s every transition on a foreign pool and on an unknown id (no ID probing)', async () => {
    const { app, otherDriver, poolId } = await arrange();

    for (const action of ['accept', 'arrive', 'start', 'complete']) {
      const foreign = await request(app)
        .post(`/api/v1/driver/pools/${poolId}/${action}`)
        .set(auth(otherDriver.token));
      expect(foreign.status, action).toBe(404);
      expect(foreign.body.error.code).toBe('NOT_FOUND');

      const unknown = await request(app)
        .post(`/api/v1/driver/pools/9a7b6c5d-1111-4222-8333-444455556666/${action}`)
        .set(auth(otherDriver.token));
      expect(unknown.status, action).toBe(404);
    }
  });
});

describe('POST /api/v1/driver/pools/:id/complete — fares + payments in one transaction (api.md §6.4)', () => {
  /** Drive the whole documented chain and return the `complete` response. */
  async function runToCompletion(fixture: Fixture) {
    for (const action of ['accept', 'arrive', 'start', 'complete']) {
      const res = await request(fixture.app)
        .post(`/api/v1/driver/pools/${fixture.poolId}/${action}`)
        .set(auth(fixture.driver.token));
      expect(res.status, action).toBe(200);
      if (action === 'complete') return res;
    }
    throw new Error('unreachable: complete was never called');
  }

  it('serves FINAL fares with the pool discount and PENDING payments for every member', async () => {
    const fixture = await arrange();
    const { app, driver, database, poolId, rides } = fixture;

    const res = await runToCompletion(fixture);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: poolId,
      status: 'COMPLETED',
      members: [
        {
          rideId: rides.nusrat,
          passenger: 'Nusrat',
          seats: 1,
          status: 'COMPLETED',
          fare: {
            status: 'FINAL',
            subtotalPoisha: 14_400,
            poolDiscountPoisha: 2_880,
            totalPoisha: 11_520,
          },
          payment: { status: 'PENDING', amountPoisha: 11_520 },
        },
        {
          rideId: rides.rafiq,
          passenger: 'Rafiq',
          seats: 1,
          status: 'COMPLETED',
          fare: {
            status: 'FINAL',
            subtotalPoisha: 14_400,
            poolDiscountPoisha: 2_880,
            totalPoisha: 11_520,
          },
          payment: { status: 'PENDING', amountPoisha: 11_520 },
        },
      ],
    });

    // Storage agrees: one transaction moved the pool, both rides, both fares
    // (ESTIMATED → FINAL) and both payments (PRD §13).
    expect(database.pools.get(poolId)?.status).toBe('COMPLETED');
    for (const ride of [rides.nusrat, rides.rafiq]) {
      expect(database.rideRequests.get(ride)?.status).toBe('COMPLETED');
    }
    expect([...database.fares.values()].map((fare) => fare.status)).toEqual(['FINAL', 'FINAL']);
    expect([...database.fares.values()].map((fare) => fare.totalPoisha)).toEqual([11_520, 11_520]);
    expect([...database.payments.values()].map((payment) => payment.amountPoisha)).toEqual([
      11_520, 11_520,
    ]);
    expect([...database.payments.values()].map((payment) => payment.status)).toEqual([
      'PENDING',
      'PENDING',
    ]);

    // The passenger's own view shows the same money side (api.md §5.3/§8).
    const passengerView = await request(app)
      .get(`/api/v1/rides/${rides.nusrat}`)
      .set(auth(fixture.passengerToken));
    expect(passengerView.status).toBe(200);
    expect(passengerView.body.data.fare).toMatchObject({ status: 'FINAL', totalPoisha: 11_520 });
    expect(passengerView.body.data.payment).toMatchObject({
      status: 'PENDING',
      amountPoisha: 11_520,
    });

    // The pool now answers the driver's history filter (FR-HISTORY-002).
    const history = await request(app)
      .get('/api/v1/driver/pools?status=COMPLETED')
      .set(auth(driver.token));
    expect(history.body.meta.total).toBe(1);

    // And completion is terminal (api.md §6.3 — a repeat is a loud 409).
    const repeat = await request(app)
      .post(`/api/v1/driver/pools/${poolId}/complete`)
      .set(auth(driver.token));
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toMatchObject({
      code: 'ILLEGAL_STATE_TRANSITION',
      details: { current: 'COMPLETED', expected: 'STARTED' },
    });
  });

  it('leaves a cancelled member out of finalization, payment and the pool discount', async () => {
    const fixture = await arrange();
    const { app, driver, database, poolId, rides } = fixture;

    // Arrange the cancellation directly: `POST /driver/pools/:id/cancel` and the
    // passenger's own cancel land in Phase 8 (todo.md, api.md §6.5). What matters
    // here is the completion side — a CANCELLED ride is skipped by the cascade.
    const cancelled = database.rideRequests.get(rides.rafiq);
    if (!cancelled) throw new Error('fixture: Rafiq ride missing');
    database.rideRequests.set(rides.rafiq, { ...cancelled, status: 'CANCELLED' });
    const pool = database.pools.get(poolId);
    if (!pool) throw new Error('fixture: pool missing');
    database.pools.set(poolId, { ...pool, seatsTaken: 1 }); // his seat went back

    const res = await runToCompletion(fixture);

    expect(res.status).toBe(200);
    const members = res.body.data.members as Array<{
      rideId: string;
      status: string;
      fare: { status: string; poolDiscountPoisha: number; totalPoisha: number } | null;
      payment: { status: string; amountPoisha: number } | null;
    }>;
    const nusrat = members.find((member) => member.rideId === rides.nusrat);
    const rafiq = members.find((member) => member.rideId === rides.rafiq);

    // The lone completer pays the undiscounted fare (FR-FARE-002: discount ≥ 2).
    expect(nusrat).toMatchObject({
      status: 'COMPLETED',
      fare: { status: 'FINAL', poolDiscountPoisha: 0, totalPoisha: 14_400 },
      payment: { status: 'PENDING', amountPoisha: 14_400 },
    });
    // The cancelled member keeps her own terminal status and owes nothing.
    expect(rafiq).toMatchObject({ status: 'CANCELLED', payment: null });
    expect(rafiq?.fare).toMatchObject({ status: 'ESTIMATED' });

    expect(database.rideRequests.get(rides.rafiq)?.status).toBe('CANCELLED');
    expect(database.pools.get(poolId)?.status).toBe('COMPLETED');
    expect(database.payments.size).toBe(1);
    expect([...database.fares.values()].filter((fare) => fare.status === 'FINAL')).toHaveLength(1);

    // A completed pool is the driver's history entry, seats and all.
    const history = await request(app)
      .get('/api/v1/driver/pools?status=COMPLETED')
      .set(auth(driver.token));
    expect(history.body.data[0]).toMatchObject({ id: poolId, status: 'COMPLETED', seatsTaken: 1 });
  });
});

describe('driver endpoints — authorization matrix (api.md §10, testing.md §5)', () => {
  it('401s without a token and 403s a passenger on every driver route', async () => {
    const { app, passengerToken, poolId, database } = await arrange();

    for (const [method, path] of driverRoutes(poolId)) {
      const call = (token?: string) => {
        const req = method === 'get' ? request(app).get(path) : request(app).post(path);
        return token === undefined ? req : req.set(auth(token));
      };

      const anonymous = await call();
      expect(anonymous.status, `${method} ${path} anonymous`).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

      const asPassenger = await call(passengerToken);
      expect(asPassenger.status, `${method} ${path} as passenger`).toBe(403);
      expect(asPassenger.body.error.code).toBe('FORBIDDEN');
    }

    // No refused call moved the pool (authz runs before the controller).
    expect(database.pools.get(poolId)?.status).toBe('OPEN');
    expect([...database.statusHistory.values()].filter((e) => e.toStatus === 'ACCEPTED')).toEqual(
      [],
    );
  });
});
