import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMatchedRide, decideMatch } from '../src/modules/matching/matching.service.js';
import type {
  MatchInput,
  OnlineVehicle,
  OpenPoolCandidate,
} from '../src/modules/matching/matching.types.js';
import { createFakeDatabase, P2002, type FakeDatabase } from './helpers/fake-database.js';

/**
 * Phase 6 pooling suite (todo.md) — three layers:
 *  1. the pure five-condition decision table (PRD §11, testing.md §3),
 *  2. transactional pool formation against fake storage: shared corridor → one
 *     pool, different corridor → two pools, full pool → 409 + rollback, the
 *     racing-creator retry, and the membership/idempotency guards, and
 *  3. static assertions that the migration really declares the partial unique
 *     indexes + CHECK the design leans on (database.md §9).
 *
 * The direct-SQL violation attempts need a live Postgres and `rideCreate.test`
 * needs Phase 4's endpoint shell — both tracked open in todo.md.
 */

/** Zone ids follow prisma/seed.ts; corridors are ordered (pickup, destination). */
const BANANI = 1;
const DHANMONDI = 4;
const MIRPUR = 5;
const UTTARA = 6;

const NUSRAT = 'u_nusrat';
const RAFIQ = 'u_rafiq';

const ONLINE_VEHICLE: OnlineVehicle = {
  id: 'veh_bullet',
  ownerId: 'u_jashim',
  seatCapacity: 3,
};

function candidate(overrides: Partial<OpenPoolCandidate> = {}): OpenPoolCandidate {
  return {
    id: 'pool_1',
    seatsTaken: 0,
    seatCapacity: 3,
    vehicle: { id: 'veh_bullet', status: 'ONLINE' },
    ...overrides,
  };
}

function seedVehicle(database: FakeDatabase, status: 'ONLINE' | 'OFFLINE' = 'ONLINE'): void {
  database.vehicles.set('veh_bullet', {
    id: 'veh_bullet',
    ownerId: 'u_jashim',
    model: 'Tesla Model 3',
    plate: 'DHK-TSL-001',
    seatCapacity: 3,
    status,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

interface SeedPoolOptions {
  id?: string;
  seatsTaken?: number;
  pickupZoneId?: number;
  destinationZoneId?: number;
}

function seedPool(database: FakeDatabase, options: SeedPoolOptions = {}): void {
  const {
    id = 'pool_1',
    seatsTaken = 0,
    pickupZoneId = BANANI,
    destinationZoneId = DHANMONDI,
  } = options;
  database.pools.set(id, {
    id,
    driverId: 'u_jashim',
    vehicleId: 'veh_bullet',
    pickupZoneId,
    destinationZoneId,
    status: 'OPEN',
    seatsTaken,
    seatCapacity: 3,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
}

function matchInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    passengerId: NUSRAT,
    pickupZoneId: BANANI,
    destinationZoneId: DHANMONDI,
    seats: 1,
    ...overrides,
  };
}

describe('decideMatch — the five conditions of PRD §11 (pure, testing.md §3)', () => {
  it('same corridor + OPEN + seats fit + vehicle ONLINE → join', () => {
    expect(decideMatch([candidate()], 1, ONLINE_VEHICLE)).toEqual({
      action: 'JOIN',
      poolId: 'pool_1',
    });
  });

  it('different corridor (no candidates) → create, not join', () => {
    expect(decideMatch([], 1, ONLINE_VEHICLE)).toEqual({ action: 'CREATE' });
  });

  it('OPEN pool exists but full → POOL_CAPACITY_EXCEEDED', () => {
    expect(decideMatch([candidate({ seatsTaken: 3 })], 1, ONLINE_VEHICLE)).toEqual({
      action: 'REJECT',
      code: 'POOL_CAPACITY_EXCEEDED',
    });
  });

  it('no OPEN pool → create a new one', () => {
    expect(decideMatch([], 2, ONLINE_VEHICLE)).toEqual({ action: 'CREATE' });
  });

  it('candidate with an OFFLINE vehicle never joins (condition 4)', () => {
    const offline = candidate({ vehicle: { id: 'veh_bullet', status: 'OFFLINE' } });
    expect(decideMatch([offline], 1, null)).toEqual({
      action: 'REJECT',
      code: 'NO_VEHICLE_AVAILABLE',
    });
  });

  it('nothing ONLINE anywhere → NO_VEHICLE_AVAILABLE', () => {
    expect(decideMatch([], 1, null)).toEqual({
      action: 'REJECT',
      code: 'NO_VEHICLE_AVAILABLE',
    });
  });

  it('seats larger than the vehicle capacity → POOL_CAPACITY_EXCEEDED (creation path)', () => {
    expect(decideMatch([], 4, { ...ONLINE_VEHICLE, seatCapacity: 3 })).toEqual({
      action: 'REJECT',
      code: 'POOL_CAPACITY_EXCEEDED',
    });
  });

  it('skips a full pool when a later candidate can seat the request', () => {
    const candidates = [
      candidate({ id: 'pool_full', seatsTaken: 3 }),
      candidate({ id: 'pool_free', seatsTaken: 1 }),
    ];
    expect(decideMatch(candidates, 2, ONLINE_VEHICLE)).toEqual({
      action: 'JOIN',
      poolId: 'pool_free',
    });
  });
});

describe('createMatchedRide — transactional pool formation (FR-POOL-001…004)', () => {
  it('shared corridor: both passengers land in one OPEN pool', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);

    const first = await createMatchedRide(database, matchInput());
    const second = await createMatchedRide(database, matchInput({ passengerId: RAFIQ }));

    expect(first.joinedExistingPool).toBe(false); // created the pool
    expect(second.joinedExistingPool).toBe(true); // joined it
    expect(second.poolId).toBe(first.poolId);
    expect(database.pools.size).toBe(1);
    expect(database.pools.get(first.poolId)?.seatsTaken).toBe(2);
    expect(database.rideRequests.size).toBe(2);
    expect(database.poolMembers.size).toBe(2);
  });

  it('different corridor → a second, separate pool', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);

    const a = await createMatchedRide(database, matchInput());
    const b = await createMatchedRide(
      database,
      matchInput({ passengerId: RAFIQ, pickupZoneId: MIRPUR, destinationZoneId: UTTARA }),
    );

    expect(b.poolId).not.toBe(a.poolId);
    expect(database.pools.size).toBe(2);
  });

  it('full pool → 409 POOL_CAPACITY_EXCEEDED and nothing persisted', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    seedPool(database, { seatsTaken: 3 });

    await expect(createMatchedRide(database, matchInput())).rejects.toMatchObject({
      code: 'POOL_CAPACITY_EXCEEDED',
      status: 409,
    });

    expect(database.rideRequests.size).toBe(0);
    expect(database.poolMembers.size).toBe(0);
    expect(database.pools.get('pool_1')?.seatsTaken).toBe(3);
  });

  it('caller with an active ride → 409 ACTIVE_RIDE_EXISTS (condition 5)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    database.rideRequests.set('ride_active', {
      id: 'ride_active',
      passengerId: NUSRAT,
      poolId: 'pool_ghost',
      pickupZoneId: BANANI,
      destinationZoneId: DHANMONDI,
      seats: 1,
      status: 'STARTED',
      clientRequestId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(createMatchedRide(database, matchInput())).rejects.toMatchObject({
      code: 'ACTIVE_RIDE_EXISTS',
    });
    expect(database.pools.size).toBe(0);
  });

  it('offline vehicle and no pool → 409 NO_VEHICLE_AVAILABLE', async () => {
    const database = createFakeDatabase();
    seedVehicle(database, 'OFFLINE');

    await expect(createMatchedRide(database, matchInput())).rejects.toMatchObject({
      code: 'NO_VEHICLE_AVAILABLE',
    });
    expect(database.pools.size).toBe(0);
  });

  it('same zone / non-positive seats are rejected before any write', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);

    await expect(
      createMatchedRide(database, matchInput({ destinationZoneId: BANANI })),
    ).rejects.toMatchObject({ code: 'SAME_ZONE' });
    await expect(createMatchedRide(database, matchInput({ seats: 0 }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(database.pools.size).toBe(0);
  });

  it('racing creators converge on one pool (unique-violation retry)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    // The rival's OPEN pool commits between our corridor SELECT and our INSERT:
    // the fake hides it from the first read so our create hits the partial unique
    // index — createMatchedRide must restart the transaction and join the winner.
    seedPool(database, { id: 'pool_rival' });

    const poolDelegate = database.prisma.pool as unknown as {
      findMany: (...args: unknown[]) => Promise<unknown>;
    };
    const originalFindMany = poolDelegate.findMany.bind(database.prisma.pool);
    let hideCorridorPool = true;
    poolDelegate.findMany = async (...args: unknown[]) => {
      if (hideCorridorPool) {
        hideCorridorPool = false;
        return []; // first read misses the rival — exactly the race window
      }
      return originalFindMany(...args);
    };

    const outcome = await createMatchedRide(database, matchInput());

    expect(outcome.poolId).toBe('pool_rival');
    expect(outcome.joinedExistingPool).toBe(true);
    expect(database.pools.size).toBe(1);
    expect(database.pools.get('pool_rival')?.seatsTaken).toBe(1);
    expect(database.rideRequests.size).toBe(1);
    expect(database.poolMembers.size).toBe(1);
  });

  it('a claim that loses the row-lock race rolls everything back (architecture §7)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    seedPool(database, { seatsTaken: 3 }); // real state: the rival filled the pool
    // The stale read (2/3) passes the decision; the conditional UPDATE then sees
    // the true row (3/3), updates 0 rows and the whole transaction rolls back.
    const poolDelegate = database.prisma.pool as unknown as {
      findMany: (...args: unknown[]) => Promise<unknown>;
    };
    const originalFindMany = poolDelegate.findMany.bind(database.prisma.pool);
    let staleRead = true;
    poolDelegate.findMany = async (...args: unknown[]) => {
      const rows = (await originalFindMany(...args)) as Array<Record<string, unknown>>;
      if (staleRead) {
        staleRead = false;
        return rows.map((row) => ({ ...row, seatsTaken: 2 }));
      }
      return rows;
    };

    await expect(createMatchedRide(database, matchInput())).rejects.toMatchObject({
      code: 'POOL_CAPACITY_EXCEEDED',
      status: 409,
    });

    expect(database.rideRequests.size).toBe(0);
    expect(database.poolMembers.size).toBe(0);
    expect(database.pools.get('pool_1')?.seatsTaken).toBe(3);
  });

  it('duplicate active membership is impossible (UNIQUE ride_request_id)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    const outcome = await createMatchedRide(database, matchInput());

    await expect(
      database.prisma.poolMember.create({
        data: { poolId: outcome.poolId, rideRequestId: outcome.rideRequestId, seats: 1 },
      }),
    ).rejects.toMatchObject({ code: P2002 });
    expect(database.poolMembers.size).toBe(1);
  });

  it('replayed clientRequestId writes are blocked by UNIQUE (passenger_id, client_request_id)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    const clientRequestId = '8f14e45f-ceea-467f-a1d2-91b60cf1f8f3';
    const outcome = await createMatchedRide(database, matchInput({ clientRequestId }));

    // Phase 4 detects replays *before* matching (api.md §5.1, returns 200); the
    // DB unique pair is the last line of defence against a racing duplicate.
    await expect(
      database.prisma.rideRequest.create({
        data: {
          passengerId: NUSRAT,
          poolId: outcome.poolId,
          pickupZoneId: BANANI,
          destinationZoneId: DHANMONDI,
          seats: 1,
          clientRequestId,
        },
      }),
    ).rejects.toMatchObject({ code: P2002 });
    expect(database.rideRequests.size).toBe(1);
  });

  it('persist hook receives the outcome inside the transaction (Phase 4 fare wiring)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);
    const seen: Array<{ poolId: string; rideRequestId: string }> = [];

    const outcome = await createMatchedRide(database, matchInput(), async (tx, result) => {
      expect(tx).toBeDefined();
      seen.push({ poolId: result.poolId, rideRequestId: result.rideRequestId });
    });

    expect(seen).toEqual([{ poolId: outcome.poolId, rideRequestId: outcome.rideRequestId }]);
  });

  it('a persist-hook failure rolls the whole claim back (one transaction)', async () => {
    const database = createFakeDatabase();
    seedVehicle(database);

    await expect(
      createMatchedRide(database, matchInput(), async () => {
        throw new Error('fare write failed');
      }),
    ).rejects.toThrow('fare write failed');

    expect(database.pools.size).toBe(0);
    expect(database.rideRequests.size).toBe(0);
    expect(database.poolMembers.size).toBe(0);
  });
});

describe('migration integrity — constraints active in SQL (database.md §9)', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/20260926193416_init/migration.sql', import.meta.url),
    'utf8',
  );

  it('declares one OPEN pool per vehicle+corridor (partial unique index)', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "idx_unique_open_pool_per_corridor"');
    expect(migration).toMatch(/WHERE \("status" = 'OPEN'\);/);
  });

  it('declares one membership row per ride request', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "pool_members_ride_request_id_key"');
  });

  it('declares the overbooking backstop CHECK (seats_taken <= seat_capacity)', () => {
    expect(migration).toMatch(/"seats_taken" <= "seat_capacity"/);
  });
});
