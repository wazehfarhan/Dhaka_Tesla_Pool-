/**
 * The error contract — api.md §1. Codes are defined once here, carry their HTTP status,
 * and are mapped to the `{ success: false, error: { code, message } }` envelope by a single
 * middleware. Keep this list in sync with the registry documented in docs/api.md.
 */
export const ERROR_CODES = [
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The one place where a code's HTTP status is decided. */
export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  SAME_ZONE: 400,
  ZONE_NOT_FOUND: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  NO_VEHICLE_AVAILABLE: 409,
  POOL_CAPACITY_EXCEEDED: 409,
  DUPLICATE_MEMBERSHIP: 409,
  ILLEGAL_STATE_TRANSITION: 409,
  RIDE_ALREADY_STARTED: 409,
  ACTIVE_RIDE_EXISTS: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', details?: unknown) {
    super('VALIDATION_ERROR', message, details);
  }
}

export class SameZoneError extends AppError {
  constructor(message = 'Pickup and destination must be different zones.') {
    super('SAME_ZONE', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super('NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode = 'CONFLICT', message = 'The request conflicts with the current state.') {
    super(code, message);
  }
}
