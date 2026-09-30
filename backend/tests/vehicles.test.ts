import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Role, VehicleStatus } from '../src/generated/prisma/client.js';
import { createTokenService } from '../src/modules/auth/token.service.js';
import { createLogger } from '../src/shared/logger.js';
import {
  createFakeDatabase,
  type FakeDatabase,
  type FakeVehicleRow,
} from './helpers/fake-database.js';

/**
 * Vehicles suite (todo.md Phase 5 addendum) — api.md §7 end to end:
 *
 *  - `GET /vehicles`: the caller's own garage only, driver-only (403 for a
 *    passenger, 401 without a token).
 *  - `POST /vehicles`: 201 (a new car starts `OFFLINE` — schema default), 409 on
 *    a duplicate plate (globally UNIQUE, even across owners), 400 for a capacity
 *    outside 1…8 or an unknown field.
 *  - `PATCH /vehicles/:id`: the `ONLINE`/`OFFLINE` toggle answering `{id,status}`,
 *    `404` for a foreign or unknown id (never 403 — api.md §1), and the documented
 *    effect of `ONLINE`: it is what lets a new ride request match a car
 *    (`NO_VEHICLE_AVAILABLE` otherwise, api.md §7.2).
 *
 * Users are seeded and tokens minted with the real token service (see
 * driver-flow.test.ts for why): bcrypt at cost 12 would otherwise dominate the
 * suite, and the credential exchange is `auth.test.ts`'s subject.
 * Storage is faked; Express, middleware, Zod and the services run for real.
 */
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

const env = {
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test' as const,
  JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long',
};

const tokens = createTokenService(env);

const BANANI = 1;
const DHANMONDI = 4;

const JASHIM = { name: 'Jashim', email: 'jashim@example.com', role: 'DRIVER' as Role };
const KAMAL = { name: 'Kamal', email: 'kamal@example.com', role: 'DRIVER' as Role };
const NUSRAT = { name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' as Role };

interface SeededUser {
  token: string;
  userId: string;
}

function seedUser(database: FakeDatabase, user: typeof JASHIM): SeededUser {
  const now = new Date();
  const id = randomUUID();
  database.users.set(id, {
    id,
    name: user.name,
    email: user.email,
    passwordHash: 'seeded-by-test-fixture',
    role: user.role,
    createdAt: now,
    updatedAt: now,
  });
  return { token: tokens.signAccessToken({ sub: id, role: user.role }), userId: id };
}

function seedVehicle(
  database: FakeDatabase,
  input: {
    id: string;
    ownerId: string;
    model: string;
    plate: string;
    seatCapacity: number;
    status?: VehicleStatus;
    createdAt?: Date;
  },
): FakeVehicleRow {
  const createdAt = input.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
  const row: FakeVehicleRow = {
    id: input.id,
    ownerId: input.ownerId,
    model: input.model,
    plate: input.plate,
    seatCapacity: input.seatCapacity,
    status: input.status ?? 'OFFLINE',
    createdAt,
    updatedAt: createdAt,
  };
  database.vehicles.set(row.id, row);
  return row;
}

/** Zones the last test drives (Banani → Dhanmondi, 7 km). */
function seedGeography(database: FakeDatabase): void {
  database.zones.set(BANANI, { id: BANANI, name: 'Banani' });
  database.zones.set(DHANMONDI, { id: DHANMONDI, name: 'Dhanmondi' });
  database.zoneDistances.set(`${BANANI}:${DHANMONDI}`, {
    zoneA: BANANI,
    zoneB: DHANMONDI,
    distanceKm: 7,
  });
}

function makeApp(): { app: Express; database: FakeDatabase } {
  const database = createFakeDatabase();
  return { app: createApp({ env, logger, database }), database };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/vehicles — the driver\u2019s garage (api.md §7.1)', () => {
  it('lists only the caller\u2019s vehicles, oldest first, with the documented fields', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);
    const kamal = seedUser(database, KAMAL);
    seedVehicle(database, {
      id: randomUUID(),
      ownerId: jashim.userId,
      model: 'Tesla Model 3',
      plate: 'DHK-TSL-001',
      seatCapacity: 3,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    seedVehicle(database, {
      id: randomUUID(),
      ownerId: jashim.userId,
      model: 'Tesla Model Y',
      plate: 'DHK-TSL-002',
      seatCapacity: 5,
      status: 'ONLINE',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    seedVehicle(database, {
      id: randomUUID(),
      ownerId: kamal.userId,
      model: 'Tesla Model S',
      plate: 'DHK-TSL-003',
      seatCapacity: 4,
      status: 'ONLINE',
    });

    const res = await request(app).get('/api/v1/vehicles').set(auth(jashim.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: expect.any(String),
        model: 'Tesla Model 3',
        plate: 'DHK-TSL-001',
        seatCapacity: 3,
        status: 'OFFLINE',
      },
      {
        id: expect.any(String),
        model: 'Tesla Model Y',
        plate: 'DHK-TSL-002',
        seatCapacity: 5,
        status: 'ONLINE',
      },
    ]);
    // Kamal's car is not the caller's business here.
    expect(JSON.stringify(res.body)).not.toContain('DHK-TSL-003');
  });

  it('401s without a token and 403s a passenger (api.md §1 role matrix)', async () => {
    const { app, database } = makeApp();
    const nusrat = seedUser(database, NUSRAT);

    const anonymous = await request(app).get('/api/v1/vehicles');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const asPassenger = await request(app).get('/api/v1/vehicles').set(auth(nusrat.token));
    expect(asPassenger.status).toBe(403);
    expect(asPassenger.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/v1/vehicles — register a car (api.md §7.1)', () => {
  it('answers 201 with the created vehicle, starting OFFLINE, and adds it to the garage', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);

    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(auth(jashim.token))
      .send({ model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      model: 'Tesla Model 3',
      plate: 'DHK-TSL-001',
      seatCapacity: 3,
      // Never implied ONLINE: the driver flips it deliberately (api.md §7.2).
      status: 'OFFLINE',
    });
    expect(database.vehicles.get(res.body.data.id as string)).toMatchObject({
      ownerId: jashim.userId,
      status: 'OFFLINE',
    });

    const garage = await request(app).get('/api/v1/vehicles').set(auth(jashim.token));
    expect(garage.body.data).toHaveLength(1);
    expect(garage.body.data[0].id).toBe(res.body.data.id);
  });

  it('rejects a duplicate plate with 409 CONFLICT, even one owned by another driver', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);
    const kamal = seedUser(database, KAMAL);
    seedVehicle(database, {
      id: randomUUID(),
      ownerId: kamal.userId,
      model: 'Tesla Model 3',
      plate: 'DHK-TSL-001',
      seatCapacity: 3,
      status: 'ONLINE',
    });

    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(auth(jashim.token))
      .send({ model: 'Tesla Model Y', plate: 'DHK-TSL-001', seatCapacity: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The plate is UNIQUE fleet-wide, so nothing was created for Jashim.
    expect([...database.vehicles.values()].filter((v) => v.ownerId === jashim.userId)).toEqual([]);
  });

  it('rejects a capacity outside 1…8 and unknown fields with 400 VALIDATION_ERROR', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);

    const invalidBodies: ReadonlyArray<Record<string, unknown>> = [
      { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 0 },
      { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 9 }, // Bullet is 3 (D-02)
      { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 2.5 },
      { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: '3' },
      { model: '', plate: 'DHK-TSL-001', seatCapacity: 3 },
      { plate: 'DHK-TSL-001', seatCapacity: 3 }, // model missing
      { model: 'Tesla Model 3', seatCapacity: 3 }, // plate missing
      { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 3, color: 'red' }, // extra key
    ];

    for (const body of invalidBodies) {
      const res = await request(app).post('/api/v1/vehicles').set(auth(jashim.token)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(database.vehicles.size).toBe(0);
  });
});

describe('PATCH /api/v1/vehicles/:id — the online toggle (api.md §7.2)', () => {
  it('flips a car ONLINE and back, answering {id, status}', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);

    const created = await request(app)
      .post('/api/v1/vehicles')
      .set(auth(jashim.token))
      .send({ model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 3 });
    const vehicleId = created.body.data.id as string;

    const online = await request(app)
      .patch(`/api/v1/vehicles/${vehicleId}`)
      .set(auth(jashim.token))
      .send({ status: 'ONLINE' });
    expect(online.status).toBe(200);
    expect(online.body.data).toEqual({ id: vehicleId, status: 'ONLINE' });
    expect(database.vehicles.get(vehicleId)?.status).toBe('ONLINE');

    const offline = await request(app)
      .patch(`/api/v1/vehicles/${vehicleId}`)
      .set(auth(jashim.token))
      .send({ status: 'OFFLINE' });
    expect(offline.status).toBe(200);
    expect(offline.body.data).toEqual({ id: vehicleId, status: 'OFFLINE' });
  });

  it('404s a foreign or unknown vehicle and 400s a malformed id or status', async () => {
    const { app, database } = makeApp();
    const jashim = seedUser(database, JASHIM);
    const kamal = seedUser(database, KAMAL);
    const kamalsCar = seedVehicle(database, {
      id: randomUUID(),
      ownerId: kamal.userId,
      model: 'Tesla Model 3',
      plate: 'DHK-TSL-001',
      seatCapacity: 3,
      status: 'OFFLINE',
    });

    const foreign = await request(app)
      .patch(`/api/v1/vehicles/${kamalsCar.id}`)
      .set(auth(jashim.token))
      .send({ status: 'ONLINE' });
    expect(foreign.status).toBe(404); // never 403 — no ID probing (api.md §1)
    expect(foreign.body.error.code).toBe('NOT_FOUND');
    expect(database.vehicles.get(kamalsCar.id)?.status).toBe('OFFLINE');

    const unknown = await request(app)
      .patch('/api/v1/vehicles/9a7b6c5d-1111-4222-8333-444455556666')
      .set(auth(jashim.token))
      .send({ status: 'ONLINE' });
    expect(unknown.status).toBe(404);

    const malformed = await request(app)
      .patch('/api/v1/vehicles/not-a-uuid')
      .set(auth(jashim.token))
      .send({ status: 'ONLINE' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const badStatus = await request(app)
      .patch(`/api/v1/vehicles/${kamalsCar.id}`)
      .set(auth(kamal.token))
      .send({ status: 'DRIVING' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/v1/vehicles/:id — the toggle\u2019s documented effect (api.md §7.2)', () => {
  it('ONLINE is what makes a new ride request matchable (NO_VEHICLE_AVAILABLE otherwise)', async () => {
    const { app, database } = makeApp();
    seedGeography(database);
    const jashim = seedUser(database, JASHIM);
    const nusrat = seedUser(database, NUSRAT);

    const created = await request(app)
      .post('/api/v1/vehicles')
      .set(auth(jashim.token))
      .send({ model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 3 });
    const vehicleId = created.body.data.id as string;
    const askForRide = () =>
      request(app)
        .post('/api/v1/rides')
        .set(auth(nusrat.token))
        .send({ pickupZone: 'Banani', destinationZone: 'Dhanmondi', seats: 1 });

    const offline = await askForRide();
    expect(offline.status).toBe(409);
    expect(offline.body.error.code).toBe('NO_VEHICLE_AVAILABLE');
    expect(database.pools.size).toBe(0);

    await request(app)
      .patch(`/api/v1/vehicles/${vehicleId}`)
      .set(auth(jashim.token))
      .send({ status: 'ONLINE' });

    const online = await askForRide();
    expect(online.status).toBe(201);
    expect(online.body.data.status).toBe('REQUESTED');

    // The car's owner is the pool's driver, so the request lands in Jashim's queue.
    const queue = await request(app).get('/api/v1/driver/pools').set(auth(jashim.token));
    expect(queue.body.meta.total).toBe(1);
    expect(queue.body.data[0].id).toBe(online.body.data.poolId);
  });
});
