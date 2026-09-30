import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleIdParamSchema,
} from './vehicles.schemas.js';
import { createVehiclesService, type VehiclesService } from './vehicles.service.js';

/**
 * Vehicles HTTP layer (api.md §7): parse with Zod → one service call → envelope.
 * `GET` answers the same `{success, data}` shape as `/zones` (api.md §1 lists);
 * `POST` is `201` with the created row; `PATCH` is `200 {data:{id,status}}`.
 */
export function createVehiclesController({ database }: { database?: Database }): {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
} {
  const service: VehiclesService = createVehiclesService({ database });

  const list: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const vehicles = await service.listVehicles(req.user.id);
    res.status(200).json({ success: true, data: vehicles });
  };

  const create: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const input = createVehicleSchema.parse(req.body);
    const vehicle = await service.createVehicle(req.user.id, input);
    res.status(201).json({ success: true, data: vehicle });
  };

  const update: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = vehicleIdParamSchema.parse(req.params);
    const { status } = updateVehicleSchema.parse(req.body);
    const vehicle = await service.updateVehicleStatus(req.user.id, id, status);
    res.status(200).json({ success: true, data: vehicle });
  };

  return { list, create, update };
}
