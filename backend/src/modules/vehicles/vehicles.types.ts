import type { VehicleStatus } from '../../generated/prisma/client.js';

/**
 * Vehicle value objects — api.md §7.1–7.2: the registry row the driver screen
 * renders, and the minimal `{id, status}` the toggle PATCH answers with.
 */
export interface VehicleSummary {
  id: string;
  model: string;
  plate: string;
  seatCapacity: number;
  status: VehicleStatus;
}

export interface VehicleStatusResponse {
  id: string;
  status: VehicleStatus;
}
