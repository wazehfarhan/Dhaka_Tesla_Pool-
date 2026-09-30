import type { Database } from '../../db/client.js';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors.js';
import { createVehiclesRepository } from './vehicles.repository.js';
import type { CreateVehicleInput } from './vehicles.schemas.js';
import type { VehicleStatusResponse, VehicleSummary } from './vehicles.types.js';
import type { VehicleStatus } from '../../generated/prisma/client.js';

/**
 * Vehicle registry — api.md §7, PRD §15 (driver's first onboarding step).
 *
 * Rules the service owns (repositories stay Prisma-only, architecture §4):
 * a plate is unique across the fleet (`409` on a duplicate — api.md §7.1),
 * every `:id` resolves **within the caller's scope** so another driver's
 * vehicle is a `404`, never a `403` (api.md §1), and a brand-new vehicle
 * starts `OFFLINE` (schema default) until the driver flips it `ONLINE`.
 *
 * `ONLINE` is what matching requires for new requests (`NO_VEHICLE_AVAILABLE`
 * — api.md §7.2); taking a vehicle offline never disturbs pools already formed.
 */
export interface VehiclesService {
  listVehicles(ownerId: string): Promise<VehicleSummary[]>;
  createVehicle(ownerId: string, input: CreateVehicleInput): Promise<VehicleSummary>;
  updateVehicleStatus(
    ownerId: string,
    vehicleId: string,
    status: VehicleStatus,
  ): Promise<VehicleStatusResponse>;
}

export function createVehiclesService({ database }: { database?: Database }): VehiclesService {
  /** Honest failure: no database → 500, never a fabricated answer (mirrors rides.service). */
  function db(): Database {
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database;
  }

  const toSummary = (vehicle: {
    id: string;
    model: string;
    plate: string;
    seatCapacity: number;
    status: VehicleStatus;
  }): VehicleSummary => ({
    id: vehicle.id,
    model: vehicle.model,
    plate: vehicle.plate,
    seatCapacity: vehicle.seatCapacity,
    status: vehicle.status,
  });

  return {
    async listVehicles(ownerId): Promise<VehicleSummary[]> {
      const vehicles = await createVehiclesRepository(db().prisma).listOwnVehicles(ownerId);
      return vehicles.map(toSummary);
    },

    async createVehicle(ownerId, input): Promise<VehicleSummary> {
      const vehicles = createVehiclesRepository(db().prisma);

      // api.md §7.1 — a duplicate plate is a 409 (the column is UNIQUE, this
      // check turns the constraint into the documented envelope). Same-plate
      // concurrent creation still ends in P2002 → CONFLICT via the error handler.
      const existing = await vehicles.findVehicleByPlate(input.plate);
      if (existing) {
        throw new ConflictError('CONFLICT', 'A vehicle with this plate already exists.');
      }

      const created = await vehicles.createVehicle({
        ownerId,
        model: input.model,
        plate: input.plate,
        seatCapacity: input.seatCapacity,
      });
      return toSummary(created);
    },

    async updateVehicleStatus(ownerId, vehicleId, status): Promise<VehicleStatusResponse> {
      const vehicles = createVehiclesRepository(db().prisma);

      // Ownership scope: foreign or unknown id → 404 (api.md §1 + §7.2).
      const owned = await vehicles.findOwnedVehicle(ownerId, vehicleId);
      if (!owned) throw new NotFoundError('Vehicle not found.');

      const updated = await vehicles.updateVehicleStatus(owned.id, status);
      return { id: updated.id, status: updated.status };
    },
  };
}
