import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RideStatus } from '../src/generated/prisma/client.js';
import { createLogger } from '../src/shared/logger.js';
import { createFakeDatabase, type FakeDatabase } from './helpers/fake-database.js';

/**
 * Phase 4 passenger-flow suite (todo.md) — the `rideCreate.test` promised by
 * testing.md §4 plus the api.md §5 read endpoints:
 *
 *  - `POST /rides`: the demo request (Banani → Dhanmondi, 11520), a second
 *    passenger joining the same pool, a different corridor getting its own pool,
 *    `clientRequestId` idempotency, the validation `400`s, the three documented
 *    `409`s, and the authorization matrix of testing.md §5 (401 / 403).
 *  - `GET /rides` + `GET /rides/:id`: pagination, status filter, ownership scope
 *    (foreign id → 404, never 403), timeline + fare + payment assembly.
 *  - `GET /zones`: public reference data.
 *
 * Storage is faked (tests/helpers/fake-database); Express, middleware, Zod,
 * services and the transactional orchestration all run for real.
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

const PASSWORD = 'supersecret123';

/** Zone ids follow `prisma/seed.ts` (database.md §3.1). */
const BANANI = 1;
const GULSHAN = 2;
const DHANMONDI = 4;
const MIRPUR = 5;
const UTTARA = 6;
const FARMGATE = 7;
const BASHUNDHARA = 8;

type TestRole = 'PASSENGER' | 'DRIVER';

const NUSRAT: { name: string; email: string; role: TestRole } = {
  name: 'Nusrat',
  email: 'nusrat@example.com',
  role: 'PASSENGER',
};
const RAFIQ: { name: string; email: string; role: TestRole } = {
  name: 'Rafiq',
  email: 'rafiq@example.com',
  role: 'PASSENGER',
};
const MEHJABIN: { name: string; email: string; role: TestRole } = {
  name: 'Mehjabin',
  email: 'mehjabin@example.com',
  role: 'PASSENGER',
};
const JASHIM: { name: string; email: string; role: TestRole } = {
  name: 'Jashim',
  email: 'jashim@example.com',
  role: 'DRIVER',
};

/**
 * Seed the reference geography: the 8 zones, the corridors this suite drives,
 * and Bullet (3 fixed seats, D-02) ONLINE.
 */
function seedGeography(
  database: FakeDatabase,
  vehicleStatus: 'ONLINE' | 'OFFLINE' = 'ONLINE',
): void {
  const zones: ReadonlyArray<readonly [number, string]> = [
    [BANANI, 'Banani'],
    [GULSHAN, 'Gulshan'],
    [3, 'Mohakhali'],
    [DHANMONDI, 'Dhanmondi'],
    [MIRPUR, 'Mirpur'],
    [UTTARA, 'Uttara'],
    [FARMGATE, 'Farmgate'],
    [BASHUNDHARA, 'Bashundhara'],
  ];
  for (const [id, name] of zones) database.zones.set(id, { id, name });
  const distances: ReadonlyArray<readonly [number, number, number]> = [
    [BANANI, DHANMONDI, 7], // the documented demo corridor (A-04)
    [BANANI, MIRPUR, 10],
    [GULSHAN, BASHUNDHARA, 12],
    [DHANMONDI, FARMGATE, 4],
  ];
  for (const [zoneA, zoneB, distanceKm] of distances) {
    database.zoneDistances.set(`${zoneA}:${zoneB}`, { zoneA, zoneB, distanceKm });
  }
  database.vehicles.set('veh_bullet', {
    id: 'veh_bullet',
    ownerId: 'u_jashim',
    model: 'Tesla Model 3',
    plate: 'DHK-TSL-001',
    seatCapacity: 3,
    status: vehicleStatus,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

async function makeApp(
  vehicleStatus: 'ONLINE' | 'OFFLINE' = 'ONLINE',
): Promise<{ app: Express; database: FakeDatabase }> {
  const database = createFakeDatabase();
  seedGeography(database, vehicleStatus);
  return { app: createApp({ env, logger, database }), database };
}

/** Register + log in a user and return its Bearer access token (api.md §2). */
async function signIn(
  app: Express,
  user: { name: string; email: string; role: TestRole },
): Promise<string> {
  const { token } = await signInWithId(app, user);
  return token;
}

/** The userId behind a token, straight from the login response. */
async function signInWithId(
  app: Express,
  user: { name: string; email: string; role: TestRole },
): Promise<{ token: string; userId: string }> {
  const registered = await request(app)
    .post('/api/v1/auth/register')
    .send({ ...user, password: PASSWORD });
  expect(registered.status, `register failed (${registered.status})`).toBe(201);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: PASSWORD });
  expect(login.status, `login failed (${login.status})`).toBe(200);
  return {
    token: login.body.data.accessToken as string,
    userId: login.body.data.user.id as string,
  };
}

function postRide(app: Express, token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`).send(body);
}

function getRides(app: Express, token: string, query = '') {
  return request(app).get(`/api/v1/rides${query}`).set('Authorization', `Bearer ${token}`);
}

function getRide(app: Express, token: string, rideId: string) {
  return request(app).get(`/api/v1/rides/${rideId}`).set('Authorization', `Bearer ${token}`);
}

const DEMO_BODY = { pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 };

interface SeedRideOptions {
  id: string;
  passengerId: string;
  poolId?: string;
  status?: RideStatus;
  seats?: number;
  pickupZoneId?: number;
  destinationZoneId?: number;
  createdAt?: string;
  fareTotalPoisha?: number;
  fareStatus?: 'ESTIMATED' | 'FINAL';
  paymentStatus?: 'PENDING' | 'PAID';
}

/**
 * A ride with its fare, its membership and — when asked — its payment, so the
 * read endpoints see a consistent ledger: every seeded member is ACTIVE and its
 * pool's `seats_taken` is the sum of those memberships (Phase 8's invariant).
 */
function seedRide(database: FakeDatabase, options: SeedRideOptions): void {
  const {
    id,
    passengerId,
    poolId = 'pool_seed',
    status = 'COMPLETED',
    seats = 1,
    pickupZoneId = BANANI,
    destinationZoneId = DHANMONDI,
    createdAt = '2026-02-01T00:00:00.000Z',
    fareTotalPoisha = 11_520,
    fareStatus = 'ESTIMATED',
    paymentStatus,
  } = options;

  const created = new Date(createdAt);
  database.rideRequests.set(id, {
    id,
    passengerId,
    poolId,
    pickupZoneId,
    destinationZoneId,
    seats,
    status,
    clientRequestId: null,
    createdAt: created,
    updatedAt: created,
  });
  database.fares.set(`fare_${id}`, {
    id: `fare_${id}`,
    rideRequestId: id,
    status: fareStatus,
    distanceKm: 7,
    baseFarePoisha: 6_000,
    distanceChargePoisha: 8_400,
    subtotalPoisha: 14_400,
    poolDiscountPoisha: 2_880,
    totalPoisha: fareTotalPoisha,
    currency: 'BDT',
    computedAt: created,
    finalizedAt: fareStatus === 'FINAL' ? created : null,
  });
  database.poolMembers.set(`member_${id}`, {
    id: `member_${id}`,
    poolId,
    rideRequestId: id,
    seats,
    status: 'ACTIVE',
    joinedAt: created,
    cancelledAt: null,
  });
  database.statusHistory.set(`history_${id}`, {
    id: `history_${id}`,
    entityType: 'RIDE_REQUEST',
    entityId: id,
    fromStatus: null,
    toStatus: 'REQUESTED',
    changedBy: passengerId,
    reason: 'RIDE_REQUESTED',
    createdAt: created,
  });
  if (paymentStatus !== undefined) {
    database.payments.set(`payment_${id}`, {
      id: `payment_${id}`,
      rideRequestId: id,
      amountPoisha: fareTotalPoisha,
      status: paymentStatus,
      method: 'SIMULATED',
      createdAt: created,
      paidAt: paymentStatus === 'PAID' ? created : null,
    });
  }

  if (!database.pools.has(poolId)) {
    database.pools.set(poolId, {
      id: poolId,
      driverId: 'u_jashim',
      vehicleId: 'veh_bullet',
      pickupZoneId,
      destinationZoneId,
      status: 'OPEN',
      seatsTaken: 0,
      seatCapacity: 3,
      createdAt: created,
      updatedAt: created,
    });
  }
  const pool = database.pools.get(poolId);
  if (pool !== undefined) {
    pool.seatsTaken = [...database.poolMembers.values()]
      .filter((member) => member.poolId === poolId && member.status === 'ACTIVE')
      .reduce((total, member) => total + member.seats, 0);
  }
}

describe('POST /api/v1/rides — request a ride (api.md §5.1)', () => {
  it('creates ride + pool + ESTIMATED fare + trail in one transaction (the demo request)', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const response = await postRide(app, token, DEMO_BODY);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    const data = response.body.data;
    expect(data).toMatchObject({
      status: 'REQUESTED',
      seats: 1,
      pickupZone: 'Banani',
      destinationZone: 'Dhanmondi',
      distanceKm: 7,
      estimate: { perSeatPoisha: 11_520, totalDuePoisha: 11_520, currency: 'BDT' },
    });
    expect(typeof data.id).toBe('string');
    expect(Number.isNaN(Date.parse(data.createdAt as string))).toBe(false);

    // Seats held, ledger written, fare stored ESTIMATED.
    expect(database.pools.size).toBe(1);
    expect(database.pools.get(data.poolId as string)).toMatchObject({
      seatsTaken: 1,
      seatCapacity: 3,
      status: 'OPEN',
    });
    expect(database.rideRequests.size).toBe(1);
    expect(database.poolMembers.size).toBe(1);
    expect([...database.fares.values()][0]).toMatchObject({
      rideRequestId: data.id,
      status: 'ESTIMATED',
      subtotalPoisha: 14_400,
      poolDiscountPoisha: 2_880,
      totalPoisha: 11_520,
      currency: 'BDT',
      finalizedAt: null,
    });

    // architecture §6 step 7 — the trail is written in the same claim.
    const trail = [...database.statusHistory.values()];
    expect(trail).toHaveLength(2);
    expect(trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'RIDE_REQUEST',
          entityId: data.id,
          toStatus: 'REQUESTED',
          reason: 'RIDE_REQUESTED',
        }),
        expect.objectContaining({
          entityType: 'POOL',
          entityId: data.poolId,
          toStatus: 'OPEN',
          reason: 'POOL_CREATED',
        }),
      ]),
    );
  });

  it('matches Rafiq onto the same corridor pool instead of creating a second one', async () => {
    const { app, database } = await makeApp();
    const nusrat = await signIn(app, NUSRAT);
    const rafiq = await signIn(app, RAFIQ);

    const first = await postRide(app, nusrat, DEMO_BODY);
    const second = await postRide(app, rafiq, DEMO_BODY);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // One shared pool (FR-POOL-001), seats 2/3 (FR-POOL-002/004).
    expect(second.body.data.poolId).toBe(first.body.data.poolId);
    expect(database.pools.size).toBe(1);
    expect(database.pools.get(first.body.data.poolId as string)?.seatsTaken).toBe(2);
    expect(database.rideRequests.size).toBe(2);
    expect(database.poolMembers.size).toBe(2);
    // The second request joined, so it wrote no POOL_CREATED trail row.
    const poolTrail = [...database.statusHistory.values()].filter(
      (entry) => entry.entityType === 'POOL',
    );
    expect(poolTrail).toHaveLength(1);
  });

  it('gives a different (ordered) corridor its own pool and its own distance', async () => {
    const { app, database } = await makeApp();
    const nusrat = await signIn(app, NUSRAT);
    const mehjabin = await signIn(app, MEHJABIN);

    const demo = await postRide(app, nusrat, DEMO_BODY);
    const other = await postRide(app, mehjabin, {
      pickupZone: 'Banani',
      destinationZone: 'Mirpur',
      seats: 1,
    });

    expect(other.status).toBe(201);
    expect(other.body.data.poolId).not.toBe(demo.body.data.poolId);
    expect(database.pools.size).toBe(2);
    // Banani → Mirpur is 10 km: 6000 + 12000 = 18000, −20% = 14400 per seat.
    expect(other.body.data.distanceKm).toBe(10);
    expect(other.body.data.estimate).toEqual({
      perSeatPoisha: 14_400,
      totalDuePoisha: 14_400,
      currency: 'BDT',
    });
  });
});

describe('POST /api/v1/rides — idempotency (api.md §5.1)', () => {
  const clientRequestId = '8f14e45f-ceea-467f-a1d2-91b60cf1f8f3';

  it('a replayed clientRequestId answers 200 with the original ride and creates nothing', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);
    const body = { ...DEMO_BODY, clientRequestId };

    const first = await postRide(app, token, body);
    const replay = await postRide(app, token, body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data.poolId).toBe(first.body.data.poolId);
    expect(replay.body.data.estimate).toEqual(first.body.data.estimate);
    // Exactly one ride, one membership, one fare, one claim's worth of trail.
    expect(database.rideRequests.size).toBe(1);
    expect(database.poolMembers.size).toBe(1);
    expect(database.fares.size).toBe(1);
    expect(database.pools.get(first.body.data.poolId as string)?.seatsTaken).toBe(1);
    expect(database.statusHistory.size).toBe(2);
  });

  it("replays the ride's current status instead of a fabricated REQUESTED", async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);
    const body = { ...DEMO_BODY, clientRequestId };

    const created = await postRide(app, token, body);
    const ride = database.rideRequests.get(created.body.data.id as string);
    expect(ride).toBeDefined();
    if (ride) ride.status = 'COMPLETED'; // the trip moved on between retries

    const replay = await postRide(app, token, body);

    expect(replay.status).toBe(200);
    expect(replay.body.data.status).toBe('COMPLETED');
  });

  it('a different key is a new request — and A-06 rejects it while the first ride is live', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    await postRide(app, token, { ...DEMO_BODY, clientRequestId });
    const second = await postRide(app, token, {
      ...DEMO_BODY,
      clientRequestId: '11111111-2222-4333-8444-555555555555',
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
    expect(database.rideRequests.size).toBe(1);
  });
});

describe('POST /api/v1/rides — validation (strict body, api.md §5.1)', () => {
  it('rejects unknown fields, missing/non-positive seats and a non-UUID key', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const cases: Array<Record<string, unknown>> = [
      { ...DEMO_BODY, fare: 999 }, // clients can never submit amounts (FR-FARE-004)
      { pickupZone: 'Banani', destinationZone: 'Dhanmondi' }, // seats missing
      { ...DEMO_BODY, seats: 0 },
      { ...DEMO_BODY, seats: '1' },
      { ...DEMO_BODY, clientRequestId: 'not-a-uuid' },
    ];

    for (const body of cases) {
      const response = await postRide(app, token, body);
      expect(response.status, `case ${JSON.stringify(body)}`).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    }
    expect(database.rideRequests.size).toBe(0);
  });

  it('rejects identical zones with 400 SAME_ZONE (case-insensitively)', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    for (const body of [
      { pickupZone: 'Banani', destinationZone: 'Banani', seats: 1 },
      { pickupZone: 'banani', destinationZone: 'Banani', seats: 1 },
    ]) {
      const response = await postRide(app, token, body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('SAME_ZONE');
    }
    expect(database.rideRequests.size).toBe(0);
  });

  it('rejects an unknown zone and a corridor with no recorded distance (400 ZONE_NOT_FOUND)', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const unknownZone = await postRide(app, token, {
      pickupZone: 'Kolkata',
      destinationZone: 'Dhanmondi',
      seats: 1,
    });
    expect(unknownZone.status).toBe(400);
    expect(unknownZone.body.error.code).toBe('ZONE_NOT_FOUND');

    // Gulshan → Uttara are both real zones but the pair has no distance row.
    const noDistance = await postRide(app, token, {
      pickupZone: 'Gulshan',
      destinationZone: 'Uttara',
      seats: 1,
    });
    expect(noDistance.status).toBe(400);
    expect(noDistance.body.error.code).toBe('ZONE_NOT_FOUND');
    expect(database.pools.size).toBe(0);
  });
});

describe('POST /api/v1/rides — the documented 409s', () => {
  it('NO_VEHICLE_AVAILABLE when nothing is ONLINE, persisting nothing at all', async () => {
    const { app, database } = await makeApp('OFFLINE');
    const token = await signIn(app, NUSRAT);

    const response = await postRide(app, token, DEMO_BODY);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_VEHICLE_AVAILABLE');
    // The transaction rolled back: no pool, no ride, no fare, no trail.
    expect(database.pools.size).toBe(0);
    expect(database.rideRequests.size).toBe(0);
    expect(database.poolMembers.size).toBe(0);
    expect(database.fares.size).toBe(0);
    expect(database.statusHistory.size).toBe(0);
  });

  it('POOL_CAPACITY_EXCEEDED on a full corridor pool, leaving seats_taken untouched', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);
    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    database.pools.set('pool_full', {
      id: 'pool_full',
      driverId: 'u_jashim',
      vehicleId: 'veh_bullet',
      pickupZoneId: BANANI,
      destinationZoneId: DHANMONDI,
      status: 'OPEN',
      seatsTaken: 3,
      seatCapacity: 3,
      createdAt,
      updatedAt: createdAt,
    });

    const response = await postRide(app, token, DEMO_BODY);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');
    expect(database.pools.get('pool_full')?.seatsTaken).toBe(3); // unchanged (FR-POOL-004)
    expect(database.rideRequests.size).toBe(0);
    expect(database.poolMembers.size).toBe(0);
  });

  it('POOL_CAPACITY_EXCEEDED when seats exceed Bullet on a corridor without a pool', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const response = await postRide(app, token, { ...DEMO_BODY, seats: 4 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');
    expect(database.pools.size).toBe(0); // no pool is created for an impossible request
  });

  it('ACTIVE_RIDE_EXISTS while the caller already holds a non-terminal ride (A-06)', async () => {
    const { app, database } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const first = await postRide(app, token, DEMO_BODY);
    expect(first.status).toBe(201);

    const second = await postRide(app, token, {
      pickupZone: 'Banani',
      destinationZone: 'Mirpur',
      seats: 1,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
    expect(database.rideRequests.size).toBe(1);
    expect(database.pools.size).toBe(1);
  });
});

describe('rides — authorization matrix (testing.md §5, api.md §10)', () => {
  it('401s without a Bearer token on every ride endpoint', async () => {
    const { app } = await makeApp();

    const create = await request(app).post('/api/v1/rides').send(DEMO_BODY);
    expect(create.status).toBe(401);
    expect(create.body.error.code).toBe('UNAUTHENTICATED');

    const list = await request(app).get('/api/v1/rides');
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe('UNAUTHENTICATED');

    const detail = await request(app).get('/api/v1/rides/8f14e45f-ceea-467f-a1d2-91b60cf1f8f3');
    expect(detail.status).toBe(401);
    expect(detail.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('403s a driver on the passenger ride endpoints', async () => {
    const { app, database } = await makeApp();
    const driver = await signIn(app, JASHIM);

    const create = await postRide(app, driver, DEMO_BODY);
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('FORBIDDEN');

    expect((await getRides(app, driver)).status).toBe(403);
    const other = await getRide(app, driver, '8f14e45f-ceea-467f-a1d2-91b60cf1f8f3');
    expect(other.status).toBe(403);
    expect(database.rideRequests.size).toBe(0);
  });
});

/** Fixture ride ids must be UUIDs — `GET /rides/:id` validates the path param. */
const RIDE_OLD = '11111111-1111-4111-8111-111111111111';
const RIDE_MID = '22222222-2222-4222-8222-222222222222';
const RIDE_NEW = '33333333-3333-4333-8333-333333333333';
const RIDE_RAFIQ = '44444444-4444-4444-8444-444444444444';
const RIDE_DONE = '55555555-5555-4555-8555-555555555555';

describe('GET /api/v1/rides — list mine (api.md §5.2, FR-HISTORY-001)', () => {
  async function seedHistory(): Promise<{ app: Express; database: FakeDatabase; token: string }> {
    const { app, database } = await makeApp();
    const { token, userId } = await signInWithId(app, NUSRAT);
    const { userId: rafiqId } = await signInWithId(app, RAFIQ);

    seedRide(database, {
      id: RIDE_OLD,
      passengerId: userId,
      poolId: 'pool_shared',
      status: 'COMPLETED',
      createdAt: '2026-02-01T00:00:00.000Z',
      fareStatus: 'FINAL',
      paymentStatus: 'PAID',
    });
    seedRide(database, {
      id: RIDE_MID,
      passengerId: userId,
      poolId: 'pool_shared',
      status: 'STARTED',
      createdAt: '2026-02-02T00:00:00.000Z',
    });
    seedRide(database, {
      id: RIDE_NEW,
      passengerId: userId,
      poolId: 'pool_live',
      status: 'REQUESTED',
      createdAt: '2026-02-03T00:00:00.000Z',
    });
    // Someone else's ride — never visible in the caller's list.
    seedRide(database, {
      id: RIDE_RAFIQ,
      passengerId: rafiqId,
      poolId: 'pool_live',
      status: 'REQUESTED',
      createdAt: '2026-02-04T00:00:00.000Z',
    });

    return { app, database, token };
  }

  it("lists only the caller's rides, newest first, with pagination meta and the money side", async () => {
    const { app, token } = await seedHistory();

    const page1 = await getRides(app, token, '?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.success).toBe(true);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3 });
    // Newest first, and Rafiq's newer ride is not in the caller's page.
    expect(page1.body.data.map((ride: { id: string }) => ride.id)).toEqual([RIDE_NEW, RIDE_MID]);
    expect(page1.body.data[0]).toMatchObject({
      status: 'REQUESTED',
      seats: 1,
      pickupZone: 'Banani',
      destinationZone: 'Dhanmondi',
      distanceKm: 7,
      fare: { status: 'ESTIMATED', totalPoisha: 11_520, currency: 'BDT' },
      payment: null,
    });

    const page2 = await getRides(app, token, '?limit=2&page=2');
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3 });
    expect(page2.body.data.map((ride: { id: string }) => ride.id)).toEqual([RIDE_OLD]);
    expect(page2.body.data[0]).toMatchObject({
      status: 'COMPLETED',
      fare: { status: 'FINAL', totalPoisha: 11_520 },
      payment: { status: 'PAID', amountPoisha: 11_520 },
    });
  });

  it('filters by a known status and treats an unknown one as an empty page (not a 400)', async () => {
    const { app, token } = await seedHistory();

    const completed = await getRides(app, token, '?status=COMPLETED');
    expect(completed.body.meta.total).toBe(1);
    expect(completed.body.data.map((ride: { id: string }) => ride.id)).toEqual([RIDE_OLD]);

    const cancelled = await getRides(app, token, '?status=CANCELLED');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toEqual([]);
    expect(cancelled.body.meta).toEqual({ page: 1, limit: 20, total: 0 });

    const nonsense = await getRides(app, token, '?status=TELEPORTED');
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.data).toEqual([]);
    expect(nonsense.body.meta.total).toBe(0);
  });

  it('rejects impossible paging with 400 VALIDATION_ERROR', async () => {
    const { app, token } = await seedHistory();

    for (const query of ['?page=0', '?page=abc', '?limit=0', '?limit=101']) {
      const response = await getRides(app, token, query);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('defaults to page 1 / limit 20 for an empty history', async () => {
    const { app } = await makeApp();
    const token = await signIn(app, NUSRAT);

    const response = await getRides(app, token);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 0 });
  });

  describe('GET /api/v1/rides/:id — ride detail (api.md §5.3)', () => {
    it('returns the ride with pool summary, timeline and ESTIMATED fare, payment still null', async () => {
      const { app } = await makeApp();
      const nusrat = await signIn(app, NUSRAT);
      const rafiq = await signIn(app, RAFIQ);
      const created = await postRide(app, nusrat, DEMO_BODY);
      await postRide(app, rafiq, DEMO_BODY); // Rafiq shares the pool: 2 seats taken
      const rideId = created.body.data.id as string;

      const response = await getRide(app, nusrat, rideId);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: rideId,
        status: 'REQUESTED',
        seats: 1,
        pickupZone: 'Banani',
        destinationZone: 'Dhanmondi',
        distanceKm: 7,
        pool: {
          id: created.body.data.poolId,
          status: 'OPEN',
          seatsTaken: 2,
          seatCapacity: 3,
          memberCount: 2,
        },
        fare: {
          status: 'ESTIMATED',
          baseFarePoisha: 6_000,
          distanceChargePoisha: 8_400,
          subtotalPoisha: 14_400,
          poolDiscountPoisha: 2_880,
          totalPoisha: 11_520,
          currency: 'BDT',
        },
        payment: null,
      });
      // Only this ride's own trail — Rafiq's REQUESTED row belongs to his ride.
      expect(response.body.data.timeline).toEqual([
        {
          fromStatus: null,
          toStatus: 'REQUESTED',
          reason: 'RIDE_REQUESTED',
          createdAt: expect.any(String),
        },
      ]);
    });

    it('404s a foreign ride and an unknown id, 400s a malformed id (no ID probing)', async () => {
      const { app } = await makeApp();
      const nusrat = await signIn(app, NUSRAT);
      const rafiq = await signIn(app, RAFIQ);
      const created = await postRide(app, nusrat, DEMO_BODY);
      const rideId = created.body.data.id as string;

      const foreign = await getRide(app, rafiq, rideId);
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('NOT_FOUND');

      const unknown = await getRide(app, nusrat, RIDE_DONE);
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');

      const malformed = await getRide(app, nusrat, 'r_123');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('shows the FINAL fare and the payment status after completion', async () => {
      const { app, database } = await makeApp();
      const { token, userId } = await signInWithId(app, NUSRAT);
      seedRide(database, {
        id: RIDE_DONE,
        passengerId: userId,
        status: 'COMPLETED',
        fareStatus: 'FINAL',
        paymentStatus: 'PENDING',
      });

      const pending = await getRide(app, token, RIDE_DONE);
      expect(pending.status).toBe(200);
      expect(pending.body.data).toMatchObject({
        status: 'COMPLETED',
        fare: {
          status: 'FINAL',
          subtotalPoisha: 14_400,
          poolDiscountPoisha: 2_880,
          totalPoisha: 11_520,
        },
        payment: { status: 'PENDING', amountPoisha: 11_520 },
      });

      // Simulated payment (api.md §8 flips PENDING → PAID): the detail follows.
      const payment = [...database.payments.values()][0];
      if (payment) {
        payment.status = 'PAID';
        payment.paidAt = new Date();
      }
      const paid = await getRide(app, token, RIDE_DONE);
      expect(paid.body.data.payment).toEqual({ status: 'PAID', amountPoisha: 11_520 });
    });
  });

  describe('GET /api/v1/zones — public dropdown data (api.md §3)', () => {
    it('needs no token and lists the 8 seeded zones in id order', async () => {
      const { app } = await makeApp();

      const response = await request(app).get('/api/v1/zones');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(8);
      expect(response.body.data[0]).toEqual({ id: BANANI, name: 'Banani' });
      expect(response.body.data[7]).toEqual({ id: BASHUNDHARA, name: 'Bashundhara' });
    });
  });
});
