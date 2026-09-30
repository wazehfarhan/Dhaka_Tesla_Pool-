import type { PoolStatus } from '../../generated/prisma/client.js';

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
