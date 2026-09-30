import type { FareStatus, Prisma } from '../../generated/prisma/client.js';

/**
 * The client the repository accepts: either the root client (plain reads and
 * writes outside a transaction) or the interactive-transaction client alive
 * inside `createMatchedRide` — the persist hook's writes must join the same
 * atomic unit (architecture §6: the claim + ride + fare + history COMMIT
 * together). Prisma's own `TransactionClient` is a subtype of `PrismaClient`
 * for the delegates used here (beta quirk), so the union is honest.
 */
export type FarePersistenceClient = Prisma.TransactionClient | PrismaClientShim;

type PrismaClientShim = Pick<
  Prisma.TransactionClient,
  'zone' | 'zoneDistance' | 'pool' | 'vehicle' | 'fare' | 'rideRequest'
>;

export interface CreateFareInput {
  rideRequestId: string;
  distanceKm: number;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPoisha: number;
  totalPoisha: number;
  currency: string;
}

export interface FinalizeFareInput {
  status: FareStatus;
  poolDiscountPoisha: number;
  totalPoisha: number;
  finalizedAt: Date;
}

/**
 * Prisma-only access to the fare's supporting reads/writes — architecture.md §4:
 * repositories issue typed queries, all business decisions stay in the service.
 *
 * Geography note: `zone_distances` stores each unordered pair once with the
 * lower zone id first (`CHECK (zone_a < zone_b)`), so `findDistance` sorts the
 * two ids before the lookup — direction never matters (ADR-004).
 */
export function createFareRepository(prisma: FarePersistenceClient) {
  return {
    async findZoneByName(name: string) {
      return prisma.zone.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    },

    async findDistance(zoneAId: number, zoneBId: number) {
      const zoneA = Math.min(zoneAId, zoneBId);
      const zoneB = Math.max(zoneAId, zoneBId);
      return prisma.zoneDistance.findUnique({ where: { zoneA_zoneB: { zoneA, zoneB } } });
    },

    /** The corridor's OPEN pool, if one exists (one per corridor — partial unique index). */
    async findOpenPool(pickupZoneId: number, destinationZoneId: number) {
      return prisma.pool.findFirst({
        where: { status: 'OPEN', pickupZoneId, destinationZoneId },
      });
    },

    /** Capacity source when no pool exists yet: the seeded Tesla (MVP has exactly one). */
    async findServiceVehicle() {
      return prisma.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });
    },

    async createFare(input: CreateFareInput) {
      return prisma.fare.create({ data: input });
    },

    async findFareByRideRequestId(rideRequestId: string) {
      return prisma.fare.findUnique({ where: { rideRequestId } });
    },

    async updateFare(id: string, data: FinalizeFareInput) {
      return prisma.fare.update({ where: { id }, data });
    },

    /** Seats come from the ride row — the client never supplies them at finalize time. */
    async findRideRequest(id: string) {
      return prisma.rideRequest.findUnique({ where: { id } });
    },
  };
}
