import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  computePerSeatPoisha,
  computePoolDiscountPoisha,
  computeSubtotalPoisha,
  createFareService,
  estimateFare,
  finalizeFare,
} from '../src/modules/fare/fare.service.js';
import { createLogger } from '../src/shared/logger.js';
import { createFakeDatabase, type FakeDatabase } from './helpers/fake-database.js';

/**
 * Phase 7 fare suite (todo.md) — two layers:
 *  1. pure maths against the hand-calculated demo numbers (PRD §12,
 *     testing.md §3), and
 *  2. the `POST /fare/estimate` HTTP contract (api.md §4) end-to-end through
 *     the real Express pipeline, with only storage faked (helpers/fake-database).
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

const PASSWORD = 'supersecret123';

/**
 * Zone ids follow `prisma/seed.ts` order; Banani ↔ Dhanmondi = 7 km drives the
 * demo fare (A-04). Bullet: 3 fixed seats (D-02).
 */
function seedGeography(database: FakeDatabase): void {
  const zones: ReadonlyArray<readonly [number, string]> = [
    [1, 'Banani'],
    [2, 'Gulshan'],
    [3, 'Mohakhali'],
    [4, 'Dhanmondi'],
    [5, 'Mirpur'],
    [6, 'Uttara'],
    [7, 'Farmgate'],
    [8, 'Bashundhara'],
  ];
  for (const [id, name] of zones) database.zones.set(id, { id, name });
  database.zoneDistances.set('1:4', { zoneA: 1, zoneB: 4, distanceKm: 7 });
  database.vehicles.set('veh_bullet', {
    id: 'veh_bullet',
    ownerId: 'u_jashim',
    model: 'Tesla Model 3',
    plate: 'DHK-TSL-001',
    seatCapacity: 3,
    status: 'OFFLINE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

async function makeApp(): Promise<{ app: Express; database: FakeDatabase }> {
  const database = createFakeDatabase();
  seedGeography(database);
  return { app: createApp({ env, logger, database }), database };
}

/** Register + log in a user of the given role — returns its Bearer access token. */
async function signIn(app: Express, role: 'PASSENGER' | 'DRIVER' = 'PASSENGER'): Promise<string> {
  const identity =
    role === 'DRIVER'
      ? { name: 'Jashim', email: 'jashim@example.com' }
      : { name: 'Nusrat', email: 'nusrat@example.com' };
  const registered = await request(app)
    .post('/api/v1/auth/register')
    .send({
      ...identity,
      password: PASSWORD,
      role,
    });
  expect(registered.status).toBe(201);

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: identity.email, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.data.accessToken as string;
}

function estimate(app: Express, token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/fare/estimate')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('fare maths (PRD §12 — integer poisha, FR-FARE-001…003)', () => {
  it('reproduces the demo: Banani → Dhanmondi 7 km, estimate with pool assumption', () => {
    const fare = estimateFare(7, 1);

    expect(computeSubtotalPoisha(7)).toBe(14_400); // 6000 + 7 × 1200
    expect(fare.baseFarePoisha).toBe(6_000);
    expect(fare.distanceChargePoisha).toBe(8_400);
    expect(fare.subtotalPoisha).toBe(14_400); // ৳144.00
    expect(fare.poolDiscountPoisha).toBe(2_880); // ৳28.80
    expect(fare.perSeatPoisha).toBe(11_520); // ৳115.20 — Nusrat's fare
    expect(fare.totalDuePoisha).toBe(11_520);
    expect(fare.poolDiscountPercent).toBe(20);
    expect(fare.currency).toBe('BDT');
  });

  it('finalizes at 11520 for ≥ 2 completers and at 14400 solo (FR-FARE-002)', () => {
    expect(finalizeFare(7, 1, 2).poolDiscountPoisha).toBe(2_880);
    expect(finalizeFare(7, 1, 2).totalDuePoisha).toBe(11_520); // Nusrat
    expect(finalizeFare(7, 1, 3).perSeatPoisha).toBe(11_520); // Rafiq — identical
    expect(finalizeFare(7, 1, 1).poolDiscountPoisha).toBe(0); // solo → no discount
    expect(finalizeFare(7, 1, 1).totalDuePoisha).toBe(14_400);
    expect(finalizeFare(7, 1, 0).totalDuePoisha).toBe(14_400); // defensive: nobody completed
  });

  it('multiplies per seat: total = perSeat × seats', () => {
    expect(estimateFare(7, 2).totalDuePoisha).toBe(23_040); // 11520 × 2
    expect(finalizeFare(7, 3, 2).totalDuePoisha).toBe(34_560); // 11520 × 3
    expect(estimateFare(7, 2).perSeatPoisha).toBe(11_520); // per seat unchanged
  });

  it('rounds the percentage discount down — exact case and odd cases', () => {
    expect(computePoolDiscountPoisha(14_400, 15)).toBe(2_160); // 15% exact
    expect(computePoolDiscountPoisha(14_401, 20)).toBe(2_880); // 2880.2 → floor
    expect(computePoolDiscountPoisha(14_405, 20)).toBe(2_881); // exact again
    expect(computePoolDiscountPoisha(14_409, 20)).toBe(2_881); // 2881.8 → floor
  });

  it('keeps the MIN_FARE guard reachable in theory but inert under this rate card', () => {
    // Shortest possible trip (1 km), solo: 6000 + 1200 = 7200 > 5000 → never fires.
    expect(finalizeFare(1, 1, 1).totalDuePoisha).toBe(7_200);
    expect(finalizeFare(1, 1, 1).totalDuePoisha).toBeGreaterThan(5_000);
    // The guard itself: a hypothetical subtotal below MIN_FARE is raised to it…
    expect(computePerSeatPoisha(4_000, 0)).toBe(5_000);
    // …while the demo subtotal passes straight through.
    expect(computePerSeatPoisha(14_400, 2_880)).toBe(11_520);
  });

  it('is deterministic: same input → byte-identical output (FR-FARE-001)', () => {
    expect(JSON.stringify(estimateFare(7, 1))).toBe(JSON.stringify(estimateFare(7, 1)));
    expect(JSON.stringify(finalizeFare(7, 2, 2))).toBe(JSON.stringify(finalizeFare(7, 2, 2)));
  });

  it('emits only safe integers — no float in the money path (FR-FARE-003)', () => {
    for (const fare of [estimateFare(7, 1), estimateFare(3, 3), finalizeFare(7, 2, 1)]) {
      for (const value of Object.values(fare)) {
        if (typeof value === 'number') expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
  });

  it('rejects impossible inputs instead of inventing money', () => {
    expect(() => estimateFare(0, 1)).toThrow('distanceKm must be a positive integer.');
    expect(() => estimateFare(7, 0)).toThrow('seats must be a positive integer.');
    expect(() => finalizeFare(7, 1, -1)).toThrow(
      'activeCompleters must be a non-negative integer.',
    );
  });
});

describe('POST /api/v1/fare/estimate (api.md §4)', () => {
  const payload = { pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 };

  const DEMO_RESPONSE = {
    distanceKm: 7,
    baseFarePoisha: 6000,
    distanceChargePoisha: 8400,
    subtotalPoisha: 14400,
    poolDiscountPercent: 20,
    estimatedDiscountPoisha: 2880,
    perSeatPoisha: 11520,
    totalDuePoisha: 11520,
    currency: 'BDT',
    assumesPoolSize: 2,
    seatCapacity: 3,
    poolAvailableSeats: 3, // no OPEN pool yet → full capacity (FR-FARE-001)
  };

  /** The api.md §4 example — identical except poolAvailableSeats reflects the pool below. */
  const DEMO_RESPONSE_WITH_POOL = { ...DEMO_RESPONSE, poolAvailableSeats: 2 };

  function seedOpenPool(database: FakeDatabase, seatsTaken: number): void {
    database.pools.set('pool_open', {
      id: 'pool_open',
      driverId: 'u_jashim',
      vehicleId: 'veh_bullet',
      pickupZoneId: 1,
      destinationZoneId: 4,
      status: 'OPEN',
      seatsTaken,
      seatCapacity: 3,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  it('requires a Bearer access token (401 UNAUTHENTICATED)', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/v1/fare/estimate').send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is PASSENGER-only: a driver gets 403 FORBIDDEN', async () => {
    const { app } = await makeApp();
    const token = await signIn(app, 'DRIVER');
    const res = await estimate(app, token, payload);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('answers the documented breakdown byte-for-byte when no pool exists yet', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: DEMO_RESPONSE });
  });

  it('matches the api.md §4 example when the corridor pool has 1 of 3 seats taken', async () => {
    const { app, database } = await makeApp();
    seedOpenPool(database, 1);
    const token = await signIn(app);
    const res = await estimate(app, token, payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: DEMO_RESPONSE_WITH_POOL });
  });

  it('shows a full pool honestly (poolAvailableSeats 0) without erroring', async () => {
    const { app, database } = await makeApp();
    seedOpenPool(database, 3);
    const token = await signIn(app);
    const res = await estimate(app, token, payload);
    // The atomic re-check still happens on POST /rides — the estimate only informs the UI.
    expect(res.status).toBe(200);
    expect(res.body.data.poolAvailableSeats).toBe(0);
    expect(res.body.data.seatCapacity).toBe(3);
  });

  it('multiplies seats: 2 seats → perSeat 11520, totalDue 23040', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, { ...payload, seats: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.perSeatPoisha).toBe(11_520);
    expect(res.body.data.totalDuePoisha).toBe(23_040);
  });

  it('rejects identical pickup and destination (400 SAME_ZONE)', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, {
      pickupZone: 'Banani',
      destinationZone: 'banani',
      seats: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_ZONE');
  });

  it('rejects unknown zones (400 ZONE_NOT_FOUND)', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, {
      pickupZone: 'Banani',
      destinationZone: 'Nowhere',
      seats: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('trims input and matches zone names case-insensitively', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, {
      pickupZone: '  banani ',
      destinationZone: 'DHANMONDI',
      seats: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.perSeatPoisha).toBe(11_520);
  });

  it('validates seats: 0 rejected, above vehicle capacity rejected (400)', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);

    const zero = await estimate(app, token, { ...payload, seats: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');

    const four = await estimate(app, token, { ...payload, seats: 4 });
    expect(four.status).toBe(400);
    expect(four.body.error.code).toBe('VALIDATION_ERROR');
    expect(four.body.error.message).toContain('1 and 3');
  });

  it('rejects unknown fields — clients can never submit amounts (FR-FARE-004)', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const res = await estimate(app, token, { ...payload, totalPoisha: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // Zod's strict-object issue carries the offending key in its message.
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ message: expect.stringContaining('totalPoisha') }),
    ]);
  });

  it('is byte-for-byte deterministic across calls (FR-FARE-001)', async () => {
    const { app } = await makeApp();
    const token = await signIn(app);
    const first = await estimate(app, token, payload);
    const second = await estimate(app, token, payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });
});

describe('fare row lifecycle (ESTIMATED → FINAL)', () => {
  function seedRide(database: FakeDatabase, id: string, seats: number): void {
    database.rideRequests.set(id, {
      id,
      passengerId: 'u_nusrat',
      poolId: 'pool_open',
      pickupZoneId: 1,
      destinationZoneId: 4,
      seats,
      status: 'REQUESTED',
      clientRequestId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  function fareRow(database: FakeDatabase, rideRequestId: string) {
    const row = database.fares.get(
      [...database.fares.values()].find((fare) => fare.rideRequestId === rideRequestId)?.id ?? '',
    );
    if (!row) throw new Error(`no fare row for ${rideRequestId}`);
    return row;
  }

  it('saves ESTIMATED at create, then FINALizes at 11520 for two completers', async () => {
    const database = createFakeDatabase();
    seedRide(database, 'ride_1', 1);
    const service = createFareService({ database });

    const estimated = await service.saveEstimate('ride_1', 7, 1);
    expect(estimated.perSeatPoisha).toBe(11_520);

    const row = fareRow(database, 'ride_1');
    expect(row.status).toBe('ESTIMATED');
    expect(row.distanceKm).toBe(7);
    expect(row.baseFarePoisha).toBe(6_000);
    expect(row.distanceChargePoisha).toBe(8_400);
    expect(row.subtotalPoisha).toBe(14_400);
    expect(row.poolDiscountPoisha).toBe(2_880);
    expect(row.totalPoisha).toBe(11_520);
    expect(row.currency).toBe('BDT');
    expect(row.finalizedAt).toBeNull();

    const final = await service.finalizeRideFare('ride_1', 2);
    expect(final.totalDuePoisha).toBe(11_520);
    expect(row.status).toBe('FINAL');
    expect(row.finalizedAt).toBeInstanceOf(Date);
  });

  it('clears the discount on a solo completion: 14400', async () => {
    const database = createFakeDatabase();
    seedRide(database, 'ride_1', 1);
    const service = createFareService({ database });

    await service.saveEstimate('ride_1', 7, 1);
    const final = await service.finalizeRideFare('ride_1', 1);

    expect(final.poolDiscountPoisha).toBe(0);
    expect(final.totalDuePoisha).toBe(14_400);
    const row = fareRow(database, 'ride_1');
    expect(row.status).toBe('FINAL');
    expect(row.poolDiscountPoisha).toBe(0);
    expect(row.totalPoisha).toBe(14_400);
  });

  it('stores total = perSeat × seats for a multi-seat ride (FR-FARE-002)', async () => {
    const database = createFakeDatabase();
    seedRide(database, 'ride_2', 2);
    const service = createFareService({ database });

    await service.saveEstimate('ride_2', 7, 2);
    expect(fareRow(database, 'ride_2').totalPoisha).toBe(23_040); // 11520 × 2

    const final = await service.finalizeRideFare('ride_2', 2);
    expect(final.perSeatPoisha).toBe(11_520);
    expect(final.totalDuePoisha).toBe(23_040);
    const row = fareRow(database, 'ride_2');
    expect(row.totalPoisha).toBe(23_040);
    expect(row.poolDiscountPoisha).toBe(2_880);
  });

  it('writes exactly once: a replayed finalize returns stored values untouched (FR-FARE-004)', async () => {
    const database = createFakeDatabase();
    seedRide(database, 'ride_1', 1);
    const service = createFareService({ database });

    await service.saveEstimate('ride_1', 7, 1);
    await service.finalizeRideFare('ride_1', 2);
    const row = fareRow(database, 'ride_1');
    const stamped = row.finalizedAt;

    // A replay with a *different* completer count must not rewrite the row.
    const replay = await service.finalizeRideFare('ride_1', 1);
    expect(replay.totalDuePoisha).toBe(11_520); // the stored value, not a fresh 14400
    expect(row.totalPoisha).toBe(11_520);
    expect(row.poolDiscountPoisha).toBe(2_880);
    expect(row.finalizedAt).toEqual(stamped);
  });

  it('404s when finalizing a ride that has no fare row', async () => {
    const database = createFakeDatabase();
    seedRide(database, 'ride_missing', 1);
    const service = createFareService({ database });

    await expect(service.finalizeRideFare('ride_missing', 2)).rejects.toThrow(
      'Fare not found for this ride.',
    );
  });
});
