import { describe, expect, it } from 'vitest';
import { PoolStatus } from '../src/generated/prisma/client.js';
import {
  DRIVER_TRANSITIONS,
  decideTransition,
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
