import type { PoolStatus, RideStatus } from '../../generated/prisma/client.js';

/**
 * Driver trip progression — PRD §8 (`OPEN → ACCEPTED → DRIVER_ARRIVED →
 * STARTED → COMPLETED`) and api.md §6.3–6.4.
 *
 * The table is deliberately pure (testing.md §3 wants `stateMachine.test.ts`
 * to prove every legal chain and reject every illegal jump without HTTP or
 * DB): the service only *applies* a rule inside its transaction. Out-of-order
 * calls (`start` before `accept`, a second `accept`, anything after
 * `COMPLETED`) are rejected with `409 ILLEGAL_STATE_TRANSITION` carrying
 * `{current, expected}` so the UI can explain the refusal (api.md §6.3).
 *
 * `reason` is what lands in `ride_status_history` (database.md §3.7) — the
 * timeline renders transitions from `toStatus`, reasons document *why*.
 */
export type DriverAction = 'accept' | 'arrive' | 'start' | 'complete';

export interface TransitionRule {
  /** The pool status this action is legal from. */
  readonly from: PoolStatus;
  /** The pool status (and the cascade target for every active ride). */
  readonly to: PoolStatus;
  /** History reason written for the pool and each cascaded ride. */
  readonly reason: string;
}

export const DRIVER_TRANSITIONS: Readonly<Record<DriverAction, TransitionRule>> = {
  accept: { from: 'OPEN', to: 'ACCEPTED', reason: 'DRIVER_ACCEPTED' },
  arrive: { from: 'ACCEPTED', to: 'DRIVER_ARRIVED', reason: 'DRIVER_ARRIVED' },
  start: { from: 'DRIVER_ARRIVED', to: 'STARTED', reason: 'TRIP_STARTED' },
  complete: { from: 'STARTED', to: 'COMPLETED', reason: 'TRIP_COMPLETED' },
};

export type TransitionDecision =
  | { ok: true; rule: TransitionRule }
  /** Illegal jump: `expected` is the status the action needs (the 409 detail). */
  | { ok: false; expected: PoolStatus };

/**
 * Is `action` legal from `current`? Pure gate for the conditional update —
 * the service still re-checks atomically inside the transaction, this decides
 * the error shape (api.md §6.3 `details: {current, expected}`).
 */
export function decideTransition(action: DriverAction, current: PoolStatus): TransitionDecision {
  const rule = DRIVER_TRANSITIONS[action];
  return rule.from === current ? { ok: true, rule } : { ok: false, expected: rule.from };
}

/**
 * Cancellation is the other exit from the state machine (PRD §8's diagram,
 * §14's table). Kept pure here, beside the progression table, so
 * `state-machine.test.ts` can prove the whole graph — including the two ways
 * *out* — without HTTP or a database.
 *
 * `STARTED` and beyond is refused with its own code (`RIDE_ALREADY_STARTED`)
 * so the UI can say "the trip has already started" rather than a generic
 * "wrong state" (api.md §5.4, architecture §5 row 6).
 */
export const CANCELLABLE_RIDE_STATUSES: readonly RideStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'DRIVER_ARRIVED',
];

/** Pool statuses from which the driver may cancel — pre-`STARTED` only (api.md §6.5). */
export const CANCELLABLE_POOL_STATUSES: readonly PoolStatus[] = [
  'OPEN',
  'ACCEPTED',
  'DRIVER_ARRIVED',
];

/**
 * History reasons for the cancellation paths (PRD §14: every cancellation is
 * auditable; `database.md §3.7` stores the reason alongside the transition).
 */
export const CANCEL_REASONS = {
  passenger: 'PASSENGER_CANCELLED',
  driver: 'DRIVER_CANCELLED',
  /** The last active member left, so the pool itself is abandoned. */
  poolEmpty: 'POOL_EMPTY',
} as const;

export type CancelSubject = 'ride' | 'pool';

export type CancelDecision =
  | { ok: true }
  /** The trip is under way — the documented 409 (PRD §14). */
  | { ok: false; code: 'RIDE_ALREADY_STARTED'; current: string }
  /** Already finished or already cancelled — the generic 409 (api.md §5.4). */
  | { ok: false; code: 'ILLEGAL_STATE_TRANSITION'; current: string };

/**
 * May `subject` be cancelled from `current`? Pure gate for the conditional
 * update: the service still re-checks atomically inside the transaction, this
 * decides which documented error comes back.
 */
export function decideCancel(subject: CancelSubject, current: string): CancelDecision {
  const allowed =
    subject === 'ride'
      ? (CANCELLABLE_RIDE_STATUSES as readonly string[]).includes(current)
      : (CANCELLABLE_POOL_STATUSES as readonly string[]).includes(current);
  if (allowed) return { ok: true };
  if (current === 'STARTED') return { ok: false, code: 'RIDE_ALREADY_STARTED', current };
  return { ok: false, code: 'ILLEGAL_STATE_TRANSITION', current };
}
