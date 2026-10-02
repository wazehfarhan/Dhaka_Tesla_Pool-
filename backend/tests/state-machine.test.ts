import { describe, expect, it } from 'vitest';
import { PoolStatus } from '../src/generated/prisma/client.js';
import {
  CANCELLABLE_POOL_STATUSES,
  CANCELLABLE_RIDE_STATUSES,
  DRIVER_TRANSITIONS,
  decideCancel,
  decideTransition,
  toCancelRefusal,
  type DriverAction,
} from '../src/modules/driver/driver.transitions.js';

/**
 * `stateMachine.test.ts` (testing.md §3) — the driver progression
 * `OPEN → ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED` (PRD §8, api.md §6.3).
 *
 * Pure by design (testing.md §3: "pure logic, no HTTP/DB"): the table and its
 * decision function are the seam the driver service applies inside its
 * transaction, so proving them here proves the legal chains and, more
 * importantly, that *every* illegal call is refused with the status the caller
 * actually needed — which is what the `409 ILLEGAL_STATE_TRANSITION`
 * `details: {current, expected}` envelope reports (api.md §6.3).
 */
const ACTIONS = Object.keys(DRIVER_TRANSITIONS) as DriverAction[];

/** Every status a pool can hold, in schema order (schema.prisma `PoolStatus`). */
const POOL_STATUSES = Object.values(PoolStatus);

/** The one documented chain, in order — each step's `to` is the next step's `from`. */
const LEGAL_CHAIN: ReadonlyArray<readonly [DriverAction, PoolStatus, PoolStatus]> = [
  ['accept', 'OPEN', 'ACCEPTED'],
  ['arrive', 'ACCEPTED', 'DRIVER_ARRIVED'],
  ['start', 'DRIVER_ARRIVED', 'STARTED'],
  ['complete', 'STARTED', 'COMPLETED'],
];

describe('driver state machine (FR-RIDE-001, PRD §8)', () => {
  it('walks the documented chain OPEN → ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED', () => {
    let current: PoolStatus = 'OPEN';
    for (const [action, from, to] of LEGAL_CHAIN) {
      expect(from, `${action} must start from ${current}`).toBe(current);
      const decision = decideTransition(action, current);
      expect(decision.ok, `${action} from ${current} must be legal`).toBe(true);
      if (!decision.ok) throw new Error('unreachable');
      expect(decision.rule.to).toBe(to);
      current = decision.rule.to;
    }
    expect(current).toBe('COMPLETED');
  });

  it('covers exactly the four documented actions, each with one legal predecessor', () => {
    expect(ACTIONS.sort()).toEqual(['accept', 'arrive', 'complete', 'start']);
    for (const action of ACTIONS) {
      const rule = DRIVER_TRANSITIONS[action];
      const legalFrom = POOL_STATUSES.filter((status) => decideTransition(action, status).ok);
      expect(legalFrom, `${action} has exactly one legal source status`).toEqual([rule.from]);
    }
  });

  it('rejects every illegal jump, reporting the status the action needs', () => {
    for (const action of ACTIONS) {
      const rule = DRIVER_TRANSITIONS[action];
      for (const current of POOL_STATUSES) {
        const decision = decideTransition(action, current);
        if (current === rule.from) {
          expect(decision.ok).toBe(true);
          continue;
        }
        // The 409 detail (api.md §6.3): `current` is read from the pool row,
        // `expected` is what this action requires — here, the pure decision.
        expect(decision.ok, `${action} from ${current} must be illegal`).toBe(false);
        expect(decision).toEqual({ ok: false, expected: rule.from });
      }
    }
  });

  it('refuses every action once the pool is COMPLETED (terminal)', () => {
    for (const action of ACTIONS) {
      expect(decideTransition(action, 'COMPLETED').ok).toBe(false);
    }
  });

  it('allows nothing from OPEN except accept — start/arrive/complete are out of order', () => {
    expect(decideTransition('arrive', 'OPEN')).toEqual({ ok: false, expected: 'ACCEPTED' });
    expect(decideTransition('start', 'OPEN')).toEqual({ ok: false, expected: 'DRIVER_ARRIVED' });
    expect(decideTransition('complete', 'OPEN')).toEqual({ ok: false, expected: 'STARTED' });
  });

  it('never reaches CANCELLED — cancelling is the passenger/Phase 8 path, not a driver action', () => {
    for (const action of ACTIONS) {
      expect(DRIVER_TRANSITIONS[action].to).not.toBe('CANCELLED');
    }
    expect(ACTIONS).not.toContain('cancel');
  });

  it('leaves no status that can silently swallow a transition', () => {
    // Every status is either a legal source for some action or terminal —
    // `CANCELLED` is the only status no driver action may act on.
    const unreachable: PoolStatus[] = POOL_STATUSES.filter(
      (status) => !ACTIONS.some((action) => decideTransition(action, status).ok),
    );
    expect(unreachable).toEqual(['COMPLETED', 'CANCELLED']);
  });
});

/**
 * The other exit from the graph: cancellation (PRD §8's diagram, §14's table).
 * Same pure-decision discipline, so the refusals are proven without HTTP or a
 * database — and the two codes are distinguishable, which is what lets the UI
 * say "the trip has started" instead of "wrong state" (api.md §5.4).
 */
describe('cancellation rules (FR-PASSENGER-005, FR-DRIVER-005, PRD §14)', () => {
  it('allows a ride to be cancelled from every pre-start status', () => {
    expect(CANCELLABLE_RIDE_STATUSES).toEqual(['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED']);
    for (const status of CANCELLABLE_RIDE_STATUSES) {
      expect(decideCancel('ride', status)).toEqual({ ok: true });
    }
  });

  it('refuses a ride once STARTED with RIDE_ALREADY_STARTED, and after with the generic 409', () => {
    expect(decideCancel('ride', 'STARTED')).toEqual({
      ok: false,
      code: 'RIDE_ALREADY_STARTED',
      current: 'STARTED',
    });
    for (const terminal of ['COMPLETED', 'CANCELLED'] as const) {
      expect(decideCancel('ride', terminal)).toEqual({
        ok: false,
        code: 'ILLEGAL_STATE_TRANSITION',
        current: terminal,
      });
    }
  });

  it('gives the driver the same window on the pool, keyed on the pool statuses', () => {
    expect(CANCELLABLE_POOL_STATUSES).toEqual(['OPEN', 'ACCEPTED', 'DRIVER_ARRIVED']);
    for (const status of CANCELLABLE_POOL_STATUSES) {
      expect(decideCancel('pool', status)).toEqual({ ok: true });
    }
    expect(decideCancel('pool', 'STARTED').ok).toBe(false);
    expect(decideCancel('pool', 'STARTED')).toMatchObject({ code: 'RIDE_ALREADY_STARTED' });
  });

  it('never lets a ride be cancelled from a status only a pool can hold', () => {
    // `OPEN` is the pool's pre-acceptance phase; a ride is never `OPEN`.
    expect(decideCancel('ride', 'OPEN').ok).toBe(false);
    expect(decideCancel('pool', 'REQUESTED').ok).toBe(false);
  });

  /**
   * The race path re-runs the decision *after* a conditional update claimed zero
   * rows, so the service knows a refusal happened even though the type still
   * allows `ok: true`. `toCancelRefusal` is what makes that callable without an
   * `as` cast: a real refusal passes through untouched (the two codes stay
   * distinguishable) and a stale "cancellable" read becomes the generic 409
   * instead of a licence to cancel.
   */
  it('normalizes a re-read decision into a refusal, never into permission', () => {
    expect(toCancelRefusal(decideCancel('ride', 'STARTED'), 'STARTED')).toEqual({
      ok: false,
      code: 'RIDE_ALREADY_STARTED',
      current: 'STARTED',
    });
    expect(toCancelRefusal(decideCancel('ride', 'CANCELLED'), 'CANCELLED')).toEqual({
      ok: false,
      code: 'ILLEGAL_STATE_TRANSITION',
      current: 'CANCELLED',
    });
    // Unreachable after a 0-row claim, but the union allows it: it must still
    // refuse, carrying the status that was just re-read.
    expect(toCancelRefusal({ ok: true }, 'ACCEPTED')).toEqual({
      ok: false,
      code: 'ILLEGAL_STATE_TRANSITION',
      current: 'ACCEPTED',
    });
  });
});
