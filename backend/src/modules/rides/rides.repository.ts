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
>;

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
