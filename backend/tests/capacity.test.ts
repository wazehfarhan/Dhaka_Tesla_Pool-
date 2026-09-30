import { describe, expect, it } from 'vitest';
import { decideMatch } from '../src/modules/matching/matching.service.js';
import type { OnlineVehicle, OpenPoolCandidate } from '../src/modules/matching/matching.types.js';

/**
 * capacity.test.ts — FR-POOL-004 boundary arithmetic `seatsTaken + n <=
 * seat_capacity` (testing.md §3: pure logic, no HTTP/DB). The atomic claim's
 * row-lock behaviour is exercised in matching.test.ts; the direct-SQL bypass
 * attempt (`UPDATE pools SET seats_taken = 4` must fail the CHECK) joins the
 * live-Postgres suite once the database is available (testing.md §6).
 */
const VEHICLE: OnlineVehicle = { id: 'veh_bullet', ownerId: 'u_jashim', seatCapacity: 3 };

function poolAt(seatsTaken: number): OpenPoolCandidate {
  return {
    id: 'pool_1',
    seatsTaken,
    seatCapacity: 3,
    vehicle: { id: 'veh_bullet', status: 'ONLINE' },
  };
}

describe('capacity boundaries (seatsTaken + n <= seat_capacity)', () => {
  it('rejects 1 seat when the pool is 3/3', () => {
    expect(decideMatch([poolAt(3)], 1, VEHICLE)).toEqual({
      action: 'REJECT',
      code: 'POOL_CAPACITY_EXCEEDED',
    });
  });

  it('accepts 1 seat when the pool is 2/3', () => {
    expect(decideMatch([poolAt(2)], 1, VEHICLE)).toEqual({ action: 'JOIN', poolId: 'pool_1' });
  });

  it('rejects 2 seats when the pool is 2/3', () => {
    expect(decideMatch([poolAt(2)], 2, VEHICLE)).toEqual({
      action: 'REJECT',
      code: 'POOL_CAPACITY_EXCEEDED',
    });
  });

  it('accepts exactly the remaining seats (1/3 + 2)', () => {
    expect(decideMatch([poolAt(1)], 2, VEHICLE)).toEqual({ action: 'JOIN', poolId: 'pool_1' });
  });

  it('rejects a request for more seats than the vehicle ever has (4 > 3)', () => {
    expect(decideMatch([], 4, VEHICLE)).toEqual({
      action: 'REJECT',
      code: 'POOL_CAPACITY_EXCEEDED',
    });
  });
});
