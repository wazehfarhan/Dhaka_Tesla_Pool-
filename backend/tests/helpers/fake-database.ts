import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/db/client.js';
import type {
  FareStatus,
  HistoryEntity,
  MemberStatus,
  PaymentStatus,
  PoolStatus,
  PrismaClient,
  RideStatus,
  Role,
  VehicleStatus,
} from '../../src/generated/prisma/client.js';

/**
 * An in-memory stand-in for the Prisma client covering exactly the queries the
 * auth and fare modules issue (docs/testing.md §4: repositories are the seam
 * for faking the data layer). Services, controllers and middleware all run for
 * real — only storage is faked, so password hashing, JWTs, rotation rules and
 * the HTTP contract are tested end-to-end without a database.
 */
export interface FakeUserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeRefreshTokenRow {
  id: string;
  userId: string;
  jtiHash: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface FakeZoneRow {
  id: number;
  name: string;
}

export interface FakeZoneDistanceRow {
  zoneA: number;
  zoneB: number;
  distanceKm: number;
}

export interface FakeVehicleRow {
  id: string;
  ownerId: string;
  model: string;
  plate: string;
  seatCapacity: number;
  status: VehicleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePoolRow {
  id: string;
  driverId: string;
  vehicleId: string;
  pickupZoneId: number;
  destinationZoneId: number;
  status: PoolStatus;
  seatsTaken: number;
  seatCapacity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeRideRequestRow {
  id: string;
  passengerId: string;
  poolId: string;
  pickupZoneId: number;
  destinationZoneId: number;
  seats: number;
  status: RideStatus;
  clientRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePoolMemberRow {
  id: string;
  poolId: string;
  rideRequestId: string;
  seats: number;
  status: MemberStatus;
  joinedAt: Date;
  cancelledAt: Date | null;
}

export interface FakeFareRow {
  id: string;
  rideRequestId: string;
  status: FareStatus;
  distanceKm: number;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPoisha: number;
  totalPoisha: number;
  currency: string;
  computedAt: Date;
  finalizedAt: Date | null;
}

export interface FakePaymentRow {
  id: string;
  rideRequestId: string;
  amountPoisha: number;
  status: PaymentStatus;
  method: string;
  createdAt: Date;
  paidAt: Date | null;
}

export interface FakeRideStatusHistoryRow {
  id: string;
  entityType: HistoryEntity;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface FakeDatabase extends Database {
  users: Map<string, FakeUserRow>;
  refreshTokens: Map<string, FakeRefreshTokenRow>;
  zones: Map<number, FakeZoneRow>;
  /** Keyed `${zoneA}:${zoneB}` with zoneA < zoneB — exactly how the table stores it. */
  zoneDistances: Map<string, FakeZoneDistanceRow>;
  vehicles: Map<string, FakeVehicleRow>;
  pools: Map<string, FakePoolRow>;
  rideRequests: Map<string, FakeRideRequestRow>;
  poolMembers: Map<string, FakePoolMemberRow>;
  fares: Map<string, FakeFareRow>;
  payments: Map<string, FakePaymentRow>;
  statusHistory: Map<string, FakeRideStatusHistoryRow>;
}

/** Prisma error codes the services translate into domain errors. */
export const P2002 = 'P2002';
export const P2025 = 'P2025';

export function createFakeDatabase(): FakeDatabase {
  const users = new Map<string, FakeUserRow>();
  const refreshTokens = new Map<string, FakeRefreshTokenRow>();
  const zones = new Map<number, FakeZoneRow>();
  const zoneDistances = new Map<string, FakeZoneDistanceRow>();
  const vehicles = new Map<string, FakeVehicleRow>();
  const pools = new Map<string, FakePoolRow>();
  const rideRequests = new Map<string, FakeRideRequestRow>();
  const poolMembers = new Map<string, FakePoolMemberRow>();
  const fares = new Map<string, FakeFareRow>();
  const payments = new Map<string, FakePaymentRow>();
  const statusHistory = new Map<string, FakeRideStatusHistoryRow>();

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email !== undefined) {
          for (const user of users.values()) {
            if (user.email === where.email) return { ...user };
          }
          return null;
        }
        if (where.id !== undefined) {
          const user = users.get(where.id);
          return user ? { ...user } : null;
        }
        return null;
      },

      create: async ({
        data,
      }: {
        data: { name: string; email: string; passwordHash: string; role: Role };
      }) => {
        for (const user of users.values()) {
          if (user.email === data.email) {
            throw Object.assign(new Error('Unique constraint failed on: email'), { code: P2002 });
          }
        }
        const now = new Date();
        const row: FakeUserRow = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
        users.set(row.id, row);
        return { ...row };
      },
    },

    refreshToken: {
      findUnique: async ({ where }: { where: { id?: string; jtiHash?: string } }) => {
        if (where.jtiHash !== undefined) {
          for (const row of refreshTokens.values()) {
            if (row.jtiHash === where.jtiHash) return { ...row };
          }
          return null;
        }
        if (where.id !== undefined) {
          const row = refreshTokens.get(where.id);
          return row ? { ...row } : null;
        }
        return null;
      },

      create: async ({ data }: { data: { userId: string; jtiHash: string; expiresAt: Date } }) => {
        const row: FakeRefreshTokenRow = {
          id: randomUUID(),
          rotatedAt: null,
          revokedAt: null,
          createdAt: new Date(),
          ...data,
        };
        refreshTokens.set(row.id, row);
        return { ...row };
      },

      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { rotatedAt?: Date; revokedAt?: Date };
      }) => {
        const row = refreshTokens.get(where.id);
        if (!row) {
          throw Object.assign(new Error('Record to update not found.'), { code: P2025 });
        }
        Object.assign(row, data);
        return { ...row };
      },
    },

    zone: {
      findFirst: async ({
        where,
      }: {
        where: { name: string | { equals: string; mode?: string } };
      }) => {
        const spec = where.name;
        const needle = typeof spec === 'string' ? spec : spec.equals;
        const insensitive = typeof spec !== 'string' && spec.mode === 'insensitive';
        for (const zone of zones.values()) {
          const hit = insensitive
            ? zone.name.toLowerCase() === needle.toLowerCase()
            : zone.name === needle;
          if (hit) return { ...zone };
        }
        return null;
      },

      findUnique: async ({ where }: { where: { id?: number; name?: string } }) => {
        if (where.id !== undefined) {
          const zone = zones.get(where.id);
          return zone ? { ...zone } : null;
        }
        if (where.name !== undefined) {
          for (const zone of zones.values()) {
            if (zone.name === where.name) return { ...zone };
          }
        }
        return null;
      },

      // GET /zones + every zone-name lookup in the rides service (8 seeded rows,
      // ordered by id = seed order — database.md §3.1).
      findMany: async ({ orderBy }: { orderBy?: { id?: 'asc' | 'desc' } } = {}) => {
        const rows = [...zones.values()].sort((a, b) =>
          orderBy?.id === 'desc' ? b.id - a.id : a.id - b.id,
        );
        return rows.map((zone) => ({ ...zone }));
      },
    },

    zoneDistance: {
      findUnique: async ({
        where,
      }: {
        where: { zoneA_zoneB: { zoneA: number; zoneB: number } };
      }) => {
        const { zoneA, zoneB } = where.zoneA_zoneB;
        const row = zoneDistances.get(`${zoneA}:${zoneB}`);
        return row ? { ...row } : null;
      },
    },

    pool: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          driverId?: string;
          status?: PoolStatus;
          pickupZoneId?: number;
          destinationZoneId?: number;
        };
      }) => {
        for (const pool of pools.values()) {
          const matches =
            (where.id === undefined || pool.id === where.id) &&
            (where.driverId === undefined || pool.driverId === where.driverId) &&
            (where.status === undefined || pool.status === where.status) &&
            (where.pickupZoneId === undefined || pool.pickupZoneId === where.pickupZoneId) &&
            (where.destinationZoneId === undefined ||
              pool.destinationZoneId === where.destinationZoneId);
          if (matches) return { ...pool };
        }
        return null;
      },

      findUnique: async ({ where }: { where: { id: string } }) => {
        const pool = pools.get(where.id);
        return pool ? { ...pool } : null;
      },

      findMany: async ({
        where,
        orderBy,
        skip,
        take,
        include,
      }: {
        where?: {
          driverId?: string;
          status?: PoolStatus;
          pickupZoneId?: number;
          destinationZoneId?: number;
        };
        orderBy?: { createdAt?: 'asc' | 'desc' };
        skip?: number;
        take?: number;
        include?: { vehicle?: { select: { id: true; status: true } } };
      }) => {
        const rows = [...pools.values()].filter(
          (pool) =>
            (where?.driverId === undefined || pool.driverId === where.driverId) &&
            (where?.status === undefined || pool.status === where.status) &&
            (where?.pickupZoneId === undefined || pool.pickupZoneId === where.pickupZoneId) &&
            (where?.destinationZoneId === undefined ||
              pool.destinationZoneId === where.destinationZoneId),
        );
        rows.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        const start = skip ?? 0;
        const page = take === undefined ? rows.slice(start) : rows.slice(start, start + take);
        return page.map((pool) => {
          if (include?.vehicle) {
            const vehicle = vehicles.get(pool.vehicleId);
            if (!vehicle) {
              throw new Error(`Fake DB: pool ${pool.id} references a missing vehicle`);
            }
            return { ...pool, vehicle: { id: vehicle.id, status: vehicle.status } };
          }
          return { ...pool };
        });
      },

      create: async ({
        data,
      }: {
        data: {
          driverId: string;
          vehicleId: string;
          pickupZoneId: number;
          destinationZoneId: number;
          seatCapacity: number;
        };
      }) => {
        // Partial UNIQUE (vehicle_id, pickup_zone_id, destination_zone_id) WHERE
        // status = 'OPEN' — idx_unique_open_pool_per_corridor (migration.sql, database.md §3.5).
        const conflict = [...pools.values()].some(
          (pool) =>
            pool.status === 'OPEN' &&
            pool.vehicleId === data.vehicleId &&
            pool.pickupZoneId === data.pickupZoneId &&
            pool.destinationZoneId === data.destinationZoneId,
        );
        if (conflict) {
          throw Object.assign(
            new Error('Unique constraint failed on idx_unique_open_pool_per_corridor'),
            { code: P2002 },
          );
        }
        const now = new Date();
        const row: FakePoolRow = {
          id: randomUUID(),
          status: 'OPEN',
          seatsTaken: 0,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        pools.set(row.id, row);
        return { ...row };
      },

      // `meta.total` for the driver queue (api.md §6.1) — same filter as the page above.
      count: async ({ where }: { where: { driverId?: string; status?: PoolStatus } }) => {
        return [...pools.values()].filter(
          (pool) =>
            (where.driverId === undefined || pool.driverId === where.driverId) &&
            (where.status === undefined || pool.status === where.status),
        ).length;
      },

      // The conditional transition flip (driver.repository.claimPoolTransition):
      // a status-gated UPDATE, exactly like Postgres under READ COMMITTED — a
      // pool that moved on matches 0 rows, which the service reports as the
      // documented 409 ILLEGAL_STATE_TRANSITION (api.md §6.3).
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: PoolStatus };
        data: { status: PoolStatus; updatedAt?: Date };
      }) => {
        const pool = pools.get(where.id);
        if (!pool || pool.status !== where.status) return { count: 0 };
        pool.status = data.status;
        pool.updatedAt = data.updatedAt ?? new Date();
        return { count: 1 };
      },
    },

    vehicle: {
      /**
       * Two shapes: matching's ONLINE pick (`{status}`, oldest first) and the
       * registry's lookups — plate uniqueness (`{plate}`) and the ownership
       * scope (`{id, ownerId}`) from vehicles.service (api.md §7).
       */
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: { id?: string; ownerId?: string; plate?: string; status?: VehicleStatus };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      }) => {
        const filtered = [...vehicles.values()].filter(
          (vehicle) =>
            (where?.id === undefined || vehicle.id === where.id) &&
            (where?.ownerId === undefined || vehicle.ownerId === where.ownerId) &&
            (where?.plate === undefined || vehicle.plate === where.plate) &&
            (where?.status === undefined || vehicle.status === where.status),
        );
        const sorted = filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const row = orderBy?.createdAt === 'desc' ? sorted[sorted.length - 1] : sorted[0];
        return row ? { ...row } : null;
      },

      /** `GET /vehicles` — the caller's garage, oldest first (api.md §7.1). */
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { ownerId?: string };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      }) => {
        const rows = [...vehicles.values()].filter(
          (vehicle) => where?.ownerId === undefined || vehicle.ownerId === where.ownerId,
        );
        rows.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return rows.map((vehicle) => ({ ...vehicle }));
      },

      /** UNIQUE (plate) — a duplicate is P2002, which the service pre-empts with a 409. */
      create: async ({
        data,
      }: {
        data: { ownerId: string; model: string; plate: string; seatCapacity: number };
      }) => {
        const conflict = [...vehicles.values()].some((vehicle) => vehicle.plate === data.plate);
        if (conflict) {
          throw Object.assign(new Error('Unique constraint failed on the fields: (`plate`)'), {
            code: P2002,
          });
        }
        const now = new Date();
        const row: FakeVehicleRow = {
          id: randomUUID(),
          status: 'OFFLINE',
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        vehicles.set(row.id, row);
        return { ...row };
      },

      /** `PATCH /vehicles/:id` — the ONLINE/OFFLINE toggle (api.md §7.2). */
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: VehicleStatus };
      }) => {
        const row = vehicles.get(where.id);
        if (!row) {
          throw Object.assign(new Error('Record to update not found.'), { code: P2025 });
        }
        row.status = data.status;
        row.updatedAt = new Date();
        return { ...row };
      },
    },

    rideRequest: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = rideRequests.get(where.id);
        return row ? { ...row } : null;
      },

      /**
       * The three `where` shapes the app issues: the active-ride probe
       * (`status: { in }`, matching.service), the idempotency lookup
       * (`clientRequestId`) and the ownership-scoped detail lookup
       * (`id` + `passengerId`) — both from rides.repository.
       */
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          passengerId?: string;
          clientRequestId?: string;
          status?: { in: RideStatus[] };
        };
      }) => {
        for (const ride of rideRequests.values()) {
          const matches =
            (where.id === undefined || ride.id === where.id) &&
            (where.passengerId === undefined || ride.passengerId === where.passengerId) &&
            (where.clientRequestId === undefined ||
              ride.clientRequestId === where.clientRequestId) &&
            (where.status === undefined || where.status.in.includes(ride.status));
          if (matches) return { ...ride };
        }
        return null;
      },

      // GET /rides — one page, newest first, money side joined (FR-HISTORY-001).
      /**
       * The `where` shapes the app issues: the passenger page
       * (`passengerId` + optional `status`), the idempotency/ownership
       * lookups, and the driver flow — a page's roster (`poolId: {in}`) or a
       * pool's cascade set (`poolId` + `status: {not: 'CANCELLED'}`) with the
       * roster's passenger name / fare / payment joined in one round trip.
       */
      findMany: async ({
        where,
        orderBy,
        skip,
        take,
        select,
        include,
      }: {
        where: {
          passengerId?: string;
          poolId?: string | { in: string[] };
          status?: RideStatus | { not: RideStatus };
        };
        orderBy?: { createdAt?: 'asc' | 'desc' };
        skip?: number;
        take?: number;
        select?: { id: true; status: true; seats: true };
        include?: {
          fare?: boolean;
          payment?: boolean;
          passenger?: { select: { name: true } };
        };
      }) => {
        const matchesPool = (ride: FakeRideRequestRow) => {
          if (where.poolId === undefined) return true;
          return typeof where.poolId === 'string'
            ? ride.poolId === where.poolId
            : where.poolId.in.includes(ride.poolId);
        };
        const matchesStatus = (ride: FakeRideRequestRow) => {
          const spec = where.status;
          if (spec === undefined) return true;
          return typeof spec === 'string' ? ride.status === spec : ride.status !== spec.not;
        };
        const rows = [...rideRequests.values()]
          .filter(
            (ride) =>
              (where.passengerId === undefined || ride.passengerId === where.passengerId) &&
              matchesPool(ride) &&
              matchesStatus(ride),
          )
          .sort((a, b) =>
            orderBy?.createdAt === 'desc'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          );
        const start = skip ?? 0;
        const page = take === undefined ? rows.slice(start) : rows.slice(start, start + take);
        // The cascade read (listActivePoolRides) selects only what it advances.
        if (select) {
          return page.map((ride) => ({ id: ride.id, status: ride.status, seats: ride.seats }));
        }
        return page.map((ride) => {
          // Integrity: a ride whose passenger row is missing is a fake-DB bug,
          // not a silent "Unknown passenger" (same stance as pool → vehicle).
          const passenger = include?.passenger ? users.get(ride.passengerId) : undefined;
          if (include?.passenger && !passenger) {
            throw new Error(`Fake DB: ride ${ride.id} references a missing passenger`);
          }
          return {
            ...ride,
            ...(passenger ? { passenger: { name: passenger.name } } : {}),
            ...(include?.fare
              ? {
                  fare: [...fares.values()].find((fare) => fare.rideRequestId === ride.id) ?? null,
                }
              : {}),
            ...(include?.payment
              ? {
                  payment:
                    [...payments.values()].find((payment) => payment.rideRequestId === ride.id) ??
                    null,
                }
              : {}),
          };
        });
      },

      /** `meta.total` for the same filter the page above used. */
      count: async ({ where }: { where: { passengerId?: string; status?: RideStatus } }) => {
        return [...rideRequests.values()].filter(
          (ride) =>
            (where.passengerId === undefined || ride.passengerId === where.passengerId) &&
            (where.status === undefined || ride.status === where.status),
        ).length;
      },

      create: async ({
        data,
      }: {
        data: {
          passengerId: string;
          poolId: string;
          pickupZoneId: number;
          destinationZoneId: number;
          seats: number;
          clientRequestId?: string | null;
          status?: RideStatus;
        };
      }) => {
        if (data.clientRequestId !== undefined && data.clientRequestId !== null) {
          // UNIQUE (passenger_id, client_request_id) — idempotent POST /rides (database.md §4).
          const conflict = [...rideRequests.values()].some(
            (ride) =>
              ride.passengerId === data.passengerId &&
              ride.clientRequestId === data.clientRequestId,
          );
          if (conflict) {
            throw Object.assign(
              new Error('Unique constraint failed on (passenger_id, client_request_id)'),
              { code: P2002 },
            );
          }
        }
        const now = new Date();
        const row: FakeRideRequestRow = {
          id: randomUUID(),
          status: data.status ?? 'REQUESTED',
          clientRequestId: data.clientRequestId ?? null,
          createdAt: now,
          updatedAt: now,
          passengerId: data.passengerId,
          poolId: data.poolId,
          pickupZoneId: data.pickupZoneId,
          destinationZoneId: data.destinationZoneId,
          seats: data.seats,
        };
        rideRequests.set(row.id, row);
        return { ...row };
      },

      /** The driver cascade's per-ride advance (driver.repository.updateRideStatus). */
      update: async ({ where, data }: { where: { id: string }; data: { status: RideStatus } }) => {
        const row = rideRequests.get(where.id);
        if (!row) {
          throw Object.assign(new Error('Record to update not found.'), { code: P2025 });
        }
        row.status = data.status;
        row.updatedAt = new Date();
        return { ...row };
      },
    },

    poolMember: {
      create: async ({
        data,
      }: {
        data: { poolId: string; rideRequestId: string; seats: number; status?: MemberStatus };
      }) => {
        // UNIQUE (ride_request_id) — one membership per request (schema note; database.md §5).
        const conflict = [...poolMembers.values()].some(
          (member) => member.rideRequestId === data.rideRequestId,
        );
        if (conflict) {
          throw Object.assign(new Error('Unique constraint failed on ride_request_id'), {
            code: P2002,
          });
        }
        const row: FakePoolMemberRow = {
          id: randomUUID(),
          status: data.status ?? 'ACTIVE',
          joinedAt: new Date(),
          cancelledAt: null,
          poolId: data.poolId,
          rideRequestId: data.rideRequestId,
          seats: data.seats,
        };
        poolMembers.set(row.id, row);
        return { ...row };
      },

      /** The roster size on the ride detail — only ACTIVE members still hold seats. */
      count: async ({ where }: { where: { poolId: string; status?: MemberStatus } }) => {
        return [...poolMembers.values()].filter(
          (member) =>
            member.poolId === where.poolId &&
            (where.status === undefined || member.status === where.status),
        ).length;
      },
    },

    fare: {
      findUnique: async ({ where }: { where: { id?: string; rideRequestId?: string } }) => {
        if (where.rideRequestId !== undefined) {
          for (const fare of fares.values()) {
            if (fare.rideRequestId === where.rideRequestId) return { ...fare };
          }
          return null;
        }
        if (where.id !== undefined) {
          const fare = fares.get(where.id);
          return fare ? { ...fare } : null;
        }
        return null;
      },

      create: async ({
        data,
      }: {
        data: Omit<FakeFareRow, 'id' | 'status' | 'computedAt' | 'finalizedAt'> & {
          status?: FareStatus;
        };
      }) => {
        const { status, ...rest } = data;
        const row: FakeFareRow = {
          id: randomUUID(),
          status: status ?? 'ESTIMATED',
          computedAt: new Date(),
          finalizedAt: null,
          ...rest,
        };
        fares.set(row.id, row);
        return { ...row };
      },

      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Omit<FakeFareRow, 'id' | 'rideRequestId'>>;
      }) => {
        const row = fares.get(where.id);
        if (!row) {
          throw Object.assign(new Error('Record to update not found.'), { code: P2025 });
        }
        Object.assign(row, data);
        return { ...row };
      },
    },

    // Simulated payments — read by GET /rides/:id (api.md §5.3) and created by
    // pool completion in Phase 5. UNIQUE (ride_request_id): one row per ride, ever.
    payment: {
      findUnique: async ({ where }: { where: { id?: string; rideRequestId?: string } }) => {
        if (where.rideRequestId !== undefined) {
          for (const payment of payments.values()) {
            if (payment.rideRequestId === where.rideRequestId) return { ...payment };
          }
          return null;
        }
        if (where.id !== undefined) {
          const payment = payments.get(where.id);
          return payment ? { ...payment } : null;
        }
        return null;
      },

      create: async ({
        data,
      }: {
        data: { rideRequestId: string; amountPoisha: number; status?: PaymentStatus };
      }) => {
        const conflict = [...payments.values()].some(
          (payment) => payment.rideRequestId === data.rideRequestId,
        );
        if (conflict) {
          throw Object.assign(new Error('Unique constraint failed on ride_request_id'), {
            code: P2002,
          });
        }
        const row: FakePaymentRow = {
          id: randomUUID(),
          status: data.status ?? 'PENDING',
          method: 'SIMULATED',
          createdAt: new Date(),
          paidAt: null,
          rideRequestId: data.rideRequestId,
          amountPoisha: data.amountPoisha,
        };
        payments.set(row.id, row);
        return { ...row };
      },
    },

    // Append-only transition trail — the ride/pool timeline (api.md §5.3).
    rideStatusHistory: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { entityType: HistoryEntity; entityId: string };
        orderBy?: { createdAt?: 'asc' | 'desc' };
      }) => {
        return [...statusHistory.values()]
          .filter(
            (entry) => entry.entityType === where.entityType && entry.entityId === where.entityId,
          )
          .sort((a, b) =>
            orderBy?.createdAt === 'desc'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          )
          .map((entry) => ({ ...entry }));
      },

      create: async ({
        data,
      }: {
        data: {
          entityType: HistoryEntity;
          entityId: string;
          fromStatus: string | null;
          toStatus: string;
          changedBy: string | null;
          reason: string | null;
        };
      }) => {
        const row: FakeRideStatusHistoryRow = { id: randomUUID(), createdAt: new Date(), ...data };
        statusHistory.set(row.id, row);
        return { ...row };
      },
    },

    // The matching seat claim's tagged template (matching.repository.claimSeats),
    // with the same conditional-UPDATE semantics Postgres applies under a row lock.
    $queryRaw: async (strings: TemplateStringsArray | readonly string[], ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE pools') && sql.includes('RETURNING id, seats_taken')) {
        const [seats, poolId] = values as [number, string];
        const pool = pools.get(poolId);
        if (pool && pool.status === 'OPEN' && pool.seatsTaken + seats <= pool.seatCapacity) {
          pool.seatsTaken += seats;
          pool.updatedAt = new Date();
          return [{ id: pool.id, seats_taken: pool.seatsTaken }];
        }
        return [];
      }
      throw new Error(`Fake $queryRaw does not support: ${sql.trim()}`);
    },

    // Two forms: array (auth's rotation — already-running promises) and interactive
    // (matching). The interactive form snapshots every table first so a thrown domain
    // error rolls the fake back the way Postgres would — a 409 persists nothing.
    $transaction: async (operation: unknown): Promise<unknown> => {
      if (Array.isArray(operation)) return Promise.all(operation);
      if (typeof operation !== 'function') {
        throw new Error('Fake $transaction supports array or callback operations only.');
      }
      const tables = [
        users,
        refreshTokens,
        zones,
        zoneDistances,
        vehicles,
        pools,
        rideRequests,
        poolMembers,
        fares,
        payments,
        statusHistory,
      ] as unknown as Array<Map<unknown, unknown>>;
      const snapshot = tables.map((table) => {
        const copy = new Map<unknown, unknown>();
        for (const [key, row] of table) {
          copy.set(key, { ...(row as object) });
        }
        return copy;
      });
      try {
        return await (operation as (tx: unknown) => Promise<unknown>)(prisma);
      } catch (error) {
        tables.forEach((table, index) => {
          const saved = snapshot[index];
          if (!saved) return;
          table.clear();
          for (const [key, row] of saved) {
            table.set(key, row);
          }
        });
        throw error;
      }
    },
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    users,
    refreshTokens,
    zones,
    zoneDistances,
    vehicles,
    pools,
    rideRequests,
    poolMembers,
    fares,
    payments,
    statusHistory,
    ping: async () => {},
    close: async () => {},
  };
}
