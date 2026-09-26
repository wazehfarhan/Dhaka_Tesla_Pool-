import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, NotFoundError, STATUS_FOR_CODE } from '../src/shared/errors.js';

/**
 * Guards the error contract in api.md §1: every documented code exists, has a status,
 * and serialises into the documented envelope (with `details` omitted when absent).
 */
describe('error contract', () => {
  it('assigns an HTTP status to every code in the registry', () => {
    for (const code of ERROR_CODES) {
      expect(STATUS_FOR_CODE[code], `missing status for ${code}`).toBeTypeOf('number');
    }
    expect(Object.keys(STATUS_FOR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('matches the registry documented in api.md', () => {
    expect([...ERROR_CODES]).toEqual([
      'VALIDATION_ERROR',
      'SAME_ZONE',
      'ZONE_NOT_FOUND',
      'UNAUTHENTICATED',
      'INVALID_CREDENTIALS',
      'FORBIDDEN',
      'NOT_FOUND',
      'EMAIL_TAKEN',
      'NO_VEHICLE_AVAILABLE',
      'POOL_CAPACITY_EXCEEDED',
      'DUPLICATE_MEMBERSHIP',
      'ILLEGAL_STATE_TRANSITION',
      'RIDE_ALREADY_STARTED',
      'ACTIVE_RIDE_EXISTS',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL',
    ]);
  });

  it('serialises AppError subclasses into the envelope without a details key', () => {
    const error = new NotFoundError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(404);
    expect(error.toEnvelope()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    });
  });

  it('carries details when they are supplied', () => {
    const error = new AppError('POOL_CAPACITY_EXCEEDED', 'No available seats remain.', {
      seatsTaken: 3,
      seatCapacity: 3,
    });

    expect(error.status).toBe(409);
    expect(error.toEnvelope().error.details).toEqual({ seatsTaken: 3, seatCapacity: 3 });
  });
});
