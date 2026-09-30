import type { Prisma, HistoryEntity, RideStatus } from '../../generated/prisma/client.js';

/** The client the rides repository accepts — root or interactive transaction. */
export type RidesPersistenceClient = Prisma.TransactionClient | RidesClientShim;

type RidesClientShim = Pick<
  Prisma.TransactionClient,
  | 'zone'
  | 'zoneDistance'
  | 'pool'
  | 'vehicle'
  | 'rideRequest'
  | 'poolMember'
  | 'fare'
  | 'payment'
  | 'rideStatusHistory'
> & {
  /**
   * `$queryRaw` is here for one method only: `releaseSeats`, the raw conditional
   * UPDATE that returns cancelled seats (architecture §7 requires the raw form,
   * and it is what keeps `seats_taken = Σ ACTIVE memberships` true under
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

/**
 * Prisma-only access for the passenger flow (api.md §3 + §5) — architecture
 * §4: repositories issue typed queries, services own the decisions.
 */
export function createRidesRepository(prisma: RidesPersistenceClient) {
  return {
    async listZones() {
      return prisma.zone.findMany({ orderBy: { id: 'asc' } });
    },

    async findZoneByName(name: string) {
      return prisma.zone.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    },

    async findDistance(zoneAId: number, zoneBId: number) {
      const zoneA = Math.min(zoneAId, zoneBId);
      const zoneB = Math.max(zoneAId, zoneBId);
      return prisma.zoneDistance.findUnique({ where: { zoneA_zoneB: { zoneA, zoneB } } });
    },

    /**
     * Idempotency replay lookup — `UNIQUE (passenger_id, client_request_id)`
     * makes retries return the original ride with 200 instead of a second 201
     * (api.md §5.1).
     */
    async findRideByClientRequestId(passengerId: string, clientRequestId: string) {
      return prisma.rideRequest.findFirst({ where: { passengerId, clientRequestId } });
    },

    /** A ride inside the caller's scope — a foreign id answers 404 (api.md §1). */
    async findOwnedRide(passengerId: string, rideId: string) {
      return prisma.rideRequest.findFirst({ where: { id: rideId, passengerId } });
    },

    /**
     * The caller's rides, newest first, one page (FR-HISTORY-001). The include
     * carries the row's own money side (fare + payment) so rendering a page
     * never fans out into N+1 reads.
     */
    async listOwnedRides(
      passengerId: string,
      status: RideStatus | undefined,
      skip: number,
      take: number,
    ) {
      const where = status === undefined ? { passengerId } : { passengerId, status };
      const [rows, total] = await Promise.all([
        prisma.rideRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          include: { fare: true, payment: true },
        }),
        prisma.rideRequest.count({ where }),
      ]);
      return { rows, total };
    },

    async findPool(poolId: string) {
      return prisma.pool.findUnique({ where: { id: poolId } });
    },

    /** The roster size on the ride detail — cancelled members no longer hold seats. */
    async countActivePoolMembers(poolId: string) {
      return prisma.poolMember.count({ where: { poolId, status: 'ACTIVE' } });
    },

    async findFare(rideRequestId: string) {
      return prisma.fare.findUnique({ where: { rideRequestId } });
    },

    async findPayment(rideRequestId: string) {
      return prisma.payment.findUnique({ where: { rideRequestId } });
    },

    /** `PENDING → PAID` for the simulated payment (api.md §8, PRD §13). */
    async markPaymentPaid(paymentId: string) {
      return prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID', paidAt: new Date() },
      });
    },

    /**
     * The conditional cancellation flip — the atomic half of
     * `POST /rides/:id/cancel`. `count === 0` means the ride moved on (the
     * driver started it, or a racing cancel won) and the service turns that into
     * the documented 409 (api.md §5.4).
     */
    async claimRideCancellation(rideId: string, expected: readonly RideStatus[]) {
      const result = await prisma.rideRequest.updateMany({
        where: { id: rideId, status: { in: [...expected] } },
        data: { status: 'CANCELLED', updatedAt: new Date() },
      });
      return result.count;
    },

    /**
     * Give the seats back — the mirror of matching's `claimSeats` (PRD §14:
     * "seats freed atomically"). The conditional UPDATE keeps the documented
     * invariant `seats_taken = Σ ACTIVE memberships` (database.md §5) true under
     * concurrency: racing cancels subtract only their own seats and the row lock
     * serialises them.
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

    /** Abandon the pool once its last active member left (PRD §14, `POOL_EMPTY`). */
    async cancelPool(poolId: string) {
      return prisma.pool.update({
        where: { id: poolId },
        data: { status: 'CANCELLED', updatedAt: new Date() },
      });
    },

    /** Append-only trail in insertion order — the ride/pool timeline (api.md §5.3). */
    async listHistory(entityType: HistoryEntity, entityId: string) {
      return prisma.rideStatusHistory.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: 'asc' },
      });
    },

    async createHistory(input: CreateHistoryInput) {
      return prisma.rideStatusHistory.create({ data: input });
    },
  };
}
