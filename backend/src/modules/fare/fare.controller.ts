import type { RequestHandler } from 'express';
import type { Database } from '../../db/client.js';
import { fareEstimateSchema } from './fare.schemas.js';
import { createFareService } from './fare.service.js';

/**
 * Fare HTTP layer (api.md §4): parse → service → envelope. The response body is
 * built by the service; this layer adds nothing to it, so the documented
 * byte-for-byte example stays the single contract.
 */
export function createFareController({ database }: { database?: Database }): {
  estimate: RequestHandler;
} {
  const service = createFareService({ database });

  const estimate: RequestHandler = async (req, res) => {
    const input = fareEstimateSchema.parse(req.body);
    const data = await service.getEstimate(input);
    res.status(200).json({ success: true, data });
  };

  return { estimate };
}
