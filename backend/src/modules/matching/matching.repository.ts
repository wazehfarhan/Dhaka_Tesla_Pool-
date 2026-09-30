import type { Prisma, RideStatus } from '../../generated/prisma/client.js';

/**
 * Transaction-scoped Prisma handle — every method runs inside the caller's
 * interactive transaction (architecture.md §4: repositories own the queries,
 * services own the decisions).
 */
export type MatchingClient = Prisma.TransactionClient;

/** Non-terminal ride states — the "has an active ride" set for PRD §11 condition 5 (A-06). */
const ACTIVE_RIDE_STATUSES: RideStatus[] = ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED'];

export interface CreatePoolInput {
  driverId: string;
  vehicleId: string;
  pickupZoneId: number;
  destinationZoneId: number;
  seatCapacity: number;
}

export interface CreateRideRequestInput {
  passengerId: string;
  poolId: string;
  pickupZoneId: number;
  destinationZoneId: number;
  seats: number;
  clientRequestId: string | null;
}

export interface CreatePoolMemberInput {
  poolId: string;
  rideRequestId: string;
  seats: number;
}

/**
 * Prisma-only access to the matching reads/writes — FR-POOL-001…004.
 *
 * All queries take resolved zone ids over the *ordered* corridor (pickup,
 * destination); `findCorridorPools` joins the pool's vehicle because conditions
 * 2–4 can only be evaluated together (PRD §11).
 */
export function createMatchingRepository(db: MatchingClient) {
  return {
    /** Condition 5: any non-terminal ride for this passenger (Assumption A-06). */
    async findActiveRide(passengerId: string) {
      return db.rideRequest.findFirst({
        where: { passengerId, status: { in: ACTIVE_RIDE_STATUSES } },
      });
    },

    /** Conditions 1–4: every OPEN pool on the corridor, oldest first, vehicle joined. */
    async findCorridorPools(pickupZoneId: number, destinationZoneId: number) {
      return db.pool.findMany({
        where: { status: 'OPEN', pickupZoneId, destinationZoneId },
        orderBy: { createdAt: 'asc' },
        include: { vehicle: { select: { id: true, status: true } } },
      });
    },

    /** The vehicle that would host a new pool — deterministic (oldest ONLINE first). */
    async findOnlineVehicle() {
      return db.vehicle.findFirst({
        where: { status: 'ONLINE' },
        orderBy: { createdAt: 'asc' },
      });
    },

    /**
     * Create the pool — the partial unique index `idx_unique_open_pool_per_corridor`
     * turns racing creators into a catchable unique violation (FR-POOL-001 retry,
     * database.md §3.5).
     */
    async createPool(input: CreatePoolInput) {
      return db.pool.create({ data: input });
    },

    /**
     * The atomic seat claim — architecture §7 verbatim: one conditional UPDATE
     * under a row lock; Postgres re-evaluates the WHERE for the blocked writer
     * (EvalPlanQual), so 0 rows means another transaction took the seat first or
     * the pool is no longer OPEN (FR-POOL-004). Returns the new `seats_taken`.
     *
     * Raw SQL is required by todo.md Phase 6 ("raw conditional UPDATE in
     * `$transaction`"); raw results keep their snake_case column names — Prisma's
     * field mapping does not apply to `$queryRaw`.
     */
    async claimSeats(poolId: string, seats: number) {
      const rows = await db.$queryRaw<Array<{ id: string; seats_taken: number }>>`
        UPDATE pools
           SET seats_taken = seats_taken + ${seats}::int,
               updated_at = now()
         WHERE id = ${poolId}::uuid
           AND status = 'OPEN'
           AND seats_taken + ${seats}::int <= seat_capacity
       RETURNING id, seats_taken
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return { id: row.id, seatsTaken: row.seats_taken };
    },

    /** The passenger's ride row — `pool_id` is NOT NULL: matching happens at creation. */
    async createRideRequest(input: CreateRideRequestInput) {
      return db.rideRequest.create({ data: input });
    },

    /** The seat ledger row — `UNIQUE (ride_request_id)` blocks a double join. */
    async createPoolMember(input: CreatePoolMemberInput) {
      return db.poolMember.create({ data: input });
    },
  };
}
