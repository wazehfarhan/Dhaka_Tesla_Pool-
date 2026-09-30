import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { listPoolsQuerySchema, poolIdParamSchema } from './driver.schemas.js';
import { createDriverService, type DriverService } from './driver.service.js';
import type { DriverAction } from './driver.transitions.js';

/**
 * Driver HTTP layer (api.md §6): parse with Zod → one service call → envelope.
 * The four progression endpoints are one code path parameterised by action —
 * each route just names which transition to apply.
 */
export function createDriverController({ database }: { database?: Database }): {
  list: RequestHandler;
  detail: RequestHandler;
  accept: RequestHandler;
  arrive: RequestHandler;
  start: RequestHandler;
  complete: RequestHandler;
} {
  const service: DriverService = createDriverService({ database });

  const list: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const query = listPoolsQuerySchema.parse(req.query);
    const { data, meta } = await service.listPools(req.user.id, query);
    res.status(200).json({ success: true, data, meta });
  };

  const detail: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    const { id } = poolIdParamSchema.parse(req.params);
    const pool = await service.getPoolDetail(req.user.id, id);
    res.status(200).json({ success: true, data: pool });
  };

  const transition =
    (action: DriverAction): RequestHandler =>
    async (req, res) => {
      if (!req.user) throw new UnauthenticatedError();
      const { id } = poolIdParamSchema.parse(req.params);
      const data = await service.transition(req.user.id, id, action);
      res.status(200).json({ success: true, data });
    };

  return {
    list,
    detail,
    accept: transition('accept'),
    arrive: transition('arrive'),
    start: transition('start'),
    complete: transition('complete'),
  };
}
