import type {
  HistoryEntity,
  PoolStatus,
  Prisma,
  RideStatus,
} from '../../generated/prisma/client.js';

/** The client the driver repository accepts — root client or the interactive transaction. */
export type DriverPersistenceClient = Prisma.TransactionClient | DriverClientShim;

type DriverClientShim = Pick<
  Prisma.TransactionClient,
  'zone' | 'zoneDistance' | 'pool' | 'rideRequest' | 'poolMember' | 'rideStatusHistory'
> & {
  /**
   * `$queryRaw` is here for one method only: `releaseSeats`, the raw conditional
   * UPDATE that gives cancelled seats back (architecture §7 requires the raw
   * form, and it is what keeps `seats_taken = Σ ACTIVE memberships` true under
   * concurrency). It stays on the interface rather than being cast at the call
   * site so the seat accounting cannot quietly lose its atomicity.
   */
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
};

export interface CreateHistoryInput {
  entityType: HistoryEntity;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  reason: string | null;
}

/** A ride row with everything the roster needs in one round trip. */
export interface PoolRideRow {
  id: string;
  poolId: string;
  passengerId: string;
  seats: number;
  status: RideStatus;
  createdAt: Date;
  passenger: { name: string };
  fare: {
    status: string;
    subtotalPoisha: number;
    poolDiscountPoisha: number;
    totalPoisha: number;
  } | null;
  payment: { status: string; amountPoisha: number } | null;
}

/**
 * Prisma-only access for the driver flow (api.md §6) — architecture §4:
 * repositories issue typed queries, services own the decisions.
 *
 * The transition's conditional update (`updateMany` gated on the expected
 * status) is the same atomic shape matching uses for the seat claim: under
 * READ COMMITTED a second concurrent transition re-evaluates the WHERE and
 * matches 0 rows, which the service turns into the documented 409.
 */
export function createDriverRepository(prisma: DriverPersistenceClient) {
  return {
    async listZones() {
      return prisma.zone.findMany({ orderBy: { id: 'asc' } });
    },

    async findDistance(zoneAId: number, zoneBId: number) {
      const zoneA = Math.min(zoneAId, zoneBId);
      const zoneB = Math.max(zoneAId, zoneBId);
      return prisma.zoneDistance.findUnique({ where: { zoneA_zoneB: { zoneA, zoneB } } });
    },

    /** The driver's pools, newest first, one page (FR-HISTORY-002 — queue + history). */
    async listOwnedPools(
      driverId: string,
      status: PoolStatus | undefined,
      skip: number,
      take: number,
    ) {
      const where = status === undefined ? { driverId } : { driverId, status };
      const [rows, total] = await Promise.all([
        prisma.pool.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        prisma.pool.count({ where }),
      ]);
      return { rows, total };
    },

    /** Roster for a page of pools — batched so a page never fans out N+1 (api.md §6.1). */
    async listRidesForPools(poolIds: string[]): Promise<PoolRideRow[]> {
      if (poolIds.length === 0) return [];
      return prisma.rideRequest.findMany({
        where: { poolId: { in: poolIds } },
        orderBy: { createdAt: 'asc' },
        include: {
          passenger: { select: { name: true } },
          fare: true,
          payment: true,
        },
      });
    },

    /** Ownership scope: a pool that exists but isn't the caller's is a 404 (api.md §1). */
    async findOwnedPool(driverId: string, poolId: string) {
      return prisma.pool.findFirst({ where: { id: poolId, driverId } });
    },

    async findPool(poolId: string) {
      return prisma.pool.findUnique({ where: { id: poolId } });
    },

    /**
     * The conditional status flip — the atomic half of every transition.
     * `count === 0` means the pool was not in the expected status (a racing
     * transition won or the action is out of order); the service re-reads to
     * shape the documented 409.
     */
    async claimPoolTransition(poolId: string, expected: PoolStatus, next: PoolStatus) {
      const result = await prisma.pool.updateMany({
        where: { id: poolId, status: expected },
        data: { status: next, updatedAt: new Date() },
      });
      return result.count;
    },

    /** Every ride in the pool with roster + money side (detail and transitions). */
    async listPoolRides(poolId: string): Promise<PoolRideRow[]> {
      return prisma.rideRequest.findMany({
        where: { poolId },
        orderBy: { createdAt: 'asc' },
        include: {
          passenger: { select: { name: true } },
          fare: true,
          payment: true,
        },
      });
    },

    /**
     * The cascade set: a ride advances with its pool unless the passenger
     * cancelled (ride `CANCELLED` is terminal — PRD §14; membership `ACTIVE`
     * ⟺ ride not cancelled, database.md §5).
     */
    async listActivePoolRides(
      poolId: string,
    ): Promise<Array<{ id: string; status: RideStatus; seats: number }>> {
      return prisma.rideRequest.findMany({
        where: { poolId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, seats: true },
      });
    },

    async updateRideStatus(rideId: string, status: RideStatus) {
      return prisma.rideRequest.update({ where: { id: rideId }, data: { status } });
    },

    /**
     * The conditional cancellation flip for a ride — the atomic half of
     * `POST /rides/:id/cancel`. `count === 0` means the ride moved on (the
     * driver started it, or another cancel won) and the service turns that into
     * the documented 409 (api.md §5.4).
     */
    async claimRideCancellation(rideId: string, expected: readonly RideStatus[]) {
      const result = await prisma.rideRequest.updateMany({
        where: { id: rideId, status: { in: [...expected] } },
        data: { status: 'CANCELLED', updatedAt: new Date() },
      });
      return result.count;
    },

    /** The same conditional flip for the pool — `POST /driver/pools/:id/cancel`. */
    async claimPoolCancellation(poolId: string, expected: readonly PoolStatus[]) {
      const result = await prisma.pool.updateMany({
        where: { id: poolId, status: { in: [...expected] } },
        data: { status: 'CANCELLED', updatedAt: new Date() },
      });
      return result.count;
    },

    /**
     * Give the seats back — the mirror of matching's `claimSeats` (PRD §14:
     * "seats freed atomically"). The conditional UPDATE keeps the documented
     * invariant `seats_taken = Σ ACTIVE memberships` (database.md §5) true
     * under concurrency: two racing cancels of different members both subtract
     * only their own seats, and the row lock serialises them.
     */
    async releaseSeats(poolId: string, seats: number) {
      const rows = await prisma.$queryRaw<Array<{ id: string; seats_taken: number }>>`
        UPDATE pools
           SET seats_taken = seats_taken - ${seats}::int,
               updated_at = now()
         WHERE id = ${poolId}::uuid
           AND seats_taken >= ${seats}::int
       RETURNING id, seats_taken
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return { id: row.id, seatsTaken: row.seats_taken };
    },

    /** The membership holding this ride's seats — flipped to CANCELLED on cancel. */
    async findMemberByRide(rideId: string) {
      return prisma.poolMember.findFirst({ where: { rideRequestId: rideId } });
    },

    async cancelMember(memberId: string) {
      return prisma.poolMember.update({
        where: { id: memberId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    },

    /**
     * Roster size after this member's cancellation. If zero, nobody is waiting
     * on the pool any more, so it is abandoned too (PRD §14, reason
     * `POOL_EMPTY`) — the only place a pool's cancellation is *not* the
     * driver's decision.
     */
    async countActivePoolMembers(poolId: string) {
      return prisma.poolMember.count({ where: { poolId, status: 'ACTIVE' } });
    },

    /** Append-only pool trail (api.md §6.2). */
    async listPoolHistory(poolId: string) {
      return prisma.rideStatusHistory.findMany({
        where: { entityType: 'POOL', entityId: poolId },
        orderBy: { createdAt: 'asc' },
      });
    },

    async createHistory(input: CreateHistoryInput) {
      return prisma.rideStatusHistory.create({ data: input });
    },
  };
}
