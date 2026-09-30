/**
 * Error copy — ui-ux §5: "Inline, human copy mapped from API codes" and
 * "no raw status codes or stack traces ever rendered".
 *
 * The API's `error.code` is the contract (api.md §1 registry, defined once in the
 * backend's `shared/errors.ts`); this table is the frontend's half of that
 * contract. Anything unmapped falls back to the API's own (human) message, and
 * only if there is none do we print a generic sentence — never a status number.
 */

import type { ApiErrorBody } from './types';

/** Thrown by `apiFetch` for every non-2xx response. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Array<{ field: string; message: string }>;

  constructor(status: number, body: ApiErrorBody | undefined, fallbackMessage: string) {
    super(body?.error?.message || fallbackMessage);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'INTERNAL';
    this.details = body?.error?.details ?? [];
  }
}

/** Network failure, aborted request, or a proxy that answered with HTML. */
export class NetworkError extends Error {
  constructor(message = 'We could not reach the server. Check your connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

const ERROR_COPY: Record<string, string> = {
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  SAME_ZONE: 'Pickup and destination must be different zones.',
  ZONE_NOT_FOUND: 'We could not find that zone — pick one from the list.',
  UNAUTHENTICATED: 'Your session expired. Please sign in again.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  FORBIDDEN: 'Your account cannot do that.',
  NOT_FOUND: 'We could not find that — it may have been removed.',
  EMAIL_TAKEN: 'That email is already registered. Try signing in instead.',
  NO_VEHICLE_AVAILABLE: 'The Tesla is offline right now.',
  POOL_CAPACITY_EXCEEDED: 'No seats left on this route — Bullet is full.',
  DUPLICATE_MEMBERSHIP: 'You already hold a seat on this trip.',
  ILLEGAL_STATE_TRANSITION: 'This trip already moved on — refreshing…',
  RIDE_ALREADY_STARTED: 'The trip has already started, so it cannot be cancelled.',
  ACTIVE_RIDE_EXISTS: 'You already have a ride in progress.',
  CONFLICT: 'That did not go through — please try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

/** True when the UI should auto-refetch after showing the message (ui-ux §5). */
export function shouldAutoRefresh(code: string): boolean {
  return code === 'ILLEGAL_STATE_TRANSITION' || code === 'CONFLICT';
}

/** Maps any thrown value to the sentence a human should read. */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    const copy = ERROR_COPY[error.code];
    if (copy !== undefined) {
      // A validation failure is more useful with the field messages appended.
      if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        return error.details.map((detail) => `${detail.field}: ${detail.message}`).join(' · ');
      }
      return copy;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return ERROR_COPY.INTERNAL;
}

/** `POOL_CAPACITY_EXCEEDED` deserves a dedicated panel, not a red line (ui-ux §5). */
export function isPoolFull(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'POOL_CAPACITY_EXCEEDED';
}

/** Both of these mean "your seat is gone in a race" — the panel copy is the same. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
