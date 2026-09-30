import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import {
  cancelRideSchema,
  createRideSchema,
  listRidesQuerySchema,
  rideIdParamSchema,
} from './rides.schemas.js';
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
  cancel: RequestHandler;
  payment: RequestHandler;
  simulatePayment: RequestHandler;
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

  const cancel: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = rideIdParamSchema.parse(req.params);
    // The body is optional (`{reason?}`) — a client that sends none still means
    // "cancel", so normalise the absent body to `{}` before parsing.
    const { reason } = cancelRideSchema.parse(req.body ?? {});
    const ride = await service.cancelRide(req.user.id, id, reason);
    res.status(200).json({ success: true, data: ride });
  };

  const payment: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = rideIdParamSchema.parse(req.params);
    const data = await service.getPayment(req.user.id, id);
    res.status(200).json({ success: true, data });
  };

  const simulatePayment: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = rideIdParamSchema.parse(req.params);
    const data = await service.simulatePayment(req.user.id, id);
    res.status(200).json({ success: true, data });
  };

  return { create, list, detail, cancel, payment, simulatePayment };
}
