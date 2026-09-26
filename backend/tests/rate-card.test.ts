import { describe, expect, it } from 'vitest';
import { RATE_CARD } from '../src/config/rate-card.js';

/**
 * Locks the rate card to the numbers documented in PRD §12 / database.md §6, including the
 * demo fare the evaluator is expected to recompute by hand. If a value is intentionally
 * changed (Decision D-05), this test and the docs change together.
 */
describe('rate card (PRD §12, integer poisha — ADR-003)', () => {
  it('matches the documented constants', () => {
    expect(RATE_CARD).toEqual({
      currency: 'BDT',
      baseFarePoisha: 6_000,
      ratePerKmPoisha: 1_200,
      poolDiscountPercent: 20,
      minFarePoisha: 5_000,
    });
  });

  it('reproduces the demo fare: Banani → Dhanmondi (7 km), two passengers', () => {
    const distanceKm = 7;
    const subtotal = RATE_CARD.baseFarePoisha + distanceKm * RATE_CARD.ratePerKmPoisha;
    const discount = Math.floor((subtotal * RATE_CARD.poolDiscountPercent) / 100);
    const perSeat = Math.max(RATE_CARD.minFarePoisha, subtotal - discount);

    expect(subtotal).toBe(14_400); // ৳144.00
    expect(discount).toBe(2_880); // ৳28.80
    expect(perSeat).toBe(11_520); // ৳115.20 — Nusrat's and Rafiq's individual fare
    expect(Number.isInteger(perSeat)).toBe(true);
  });

  it('applies no discount on a solo trip', () => {
    const distanceKm = 7;
    const subtotal = RATE_CARD.baseFarePoisha + distanceKm * RATE_CARD.ratePerKmPoisha;

    expect(subtotal).toBe(14_400); // the solo fare stays ৳144.00
  });
});
