import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { createRideSchema, listRidesQuerySchema, rideIdParamSchema } from './rides.schemas.js';
import { createRidesService } from './rides.service.js';

/**
 * Rides HTTP layer (api.md §5): parse with Zod → one service call → envelope.
 * The only interesting decision here is the status code: `201` for a fresh ride,
 * `200` when the `clientRequestId` replay returned the original one.
 */
export function createRidesController({ database }: { database?: Database }): {
  create: RequestHandler;
  list: RequestHandler;
  detail: RequestHandler;
} {
  const service = createRidesService({ database });

  const create: RequestHandler = async (req, res) => {
    // `authenticate` runs first; a belt-and-braces guard keeps the types honest.
    if (!req.user) throw new UnauthenticatedError();
    const input = createRideSchema.parse(req.body);
    const { status, ride } = await service.createRide(req.user.id, input);
    res.status(status).json({ success: true, data: ride });
  };

  const list: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const query = listRidesQuerySchema.parse(req.query);
    const { data, meta } = await service.listRides(req.user.id, query);
    res.status(200).json({ success: true, data, meta });
  };

  const detail: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = rideIdParamSchema.parse(req.params);
    const ride = await service.getRideDetail(req.user.id, id);
    res.status(200).json({ success: true, data: ride });
  };

  return { create, list, detail };
}
