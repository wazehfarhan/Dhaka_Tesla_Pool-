import type { Prisma, VehicleStatus } from '../../generated/prisma/client.js';

/** The client the vehicles repository accepts — root client or a transaction. */
export type VehiclesPersistenceClient = Prisma.TransactionClient | VehiclesClientShim;

type VehiclesClientShim = Pick<Prisma.TransactionClient, 'vehicle'>;

/**
 * Prisma-only access for the vehicle registry (api.md §7) — architecture §4:
 * repositories issue typed queries, the service owns the decisions (duplicate
 * plate, ownership scope).
 */
export function createVehiclesRepository(prisma: VehiclesPersistenceClient) {
  return {
    /** `GET /vehicles` — the caller's own garage, oldest first. */
    async listOwnVehicles(ownerId: string) {
      return prisma.vehicle.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'asc' },
      });
    },

    /** Plate uniqueness check for `POST /vehicles`' 409 (api.md §7.1). */
    async findVehicleByPlate(plate: string) {
      return prisma.vehicle.findFirst({ where: { plate } });
    },

    async createVehicle(data: {
      ownerId: string;
      model: string;
      plate: string;
      seatCapacity: number;
    }) {
      return prisma.vehicle.create({ data });
    },

    /** Ownership scope: another driver's vehicle is a 404, never a 403 (api.md §1). */
    async findOwnedVehicle(ownerId: string, vehicleId: string) {
      return prisma.vehicle.findFirst({ where: { id: vehicleId, ownerId } });
    },

    async updateVehicleStatus(id: string, status: VehicleStatus) {
      return prisma.vehicle.update({ where: { id }, data: { status } });
    },
  };
}
