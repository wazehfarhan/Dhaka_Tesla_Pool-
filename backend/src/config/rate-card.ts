/**
 * Fare rate card — PRD §12, database.md §6 (Assumptions A-03 / A-04, Decision D-05).
 *
 * All amounts are integer POISHA (1 BDT = 100 poisha) — ADR-003. There are no floats in the
 * money path anywhere.
 *
 * Worked example (the demo, verifiable by hand):
 *   Banani → Dhanmondi = 7 km, pool completes with Nusrat + Rafiq:
 *   subtotal   = 6_000 + (7 × 1_200)          = 14_400 poisha
 *   discount   = floor(14_400 × 20 ÷ 100)     =  2_880 poisha
 *   per seat   = 14_400 − 2_880               = 11_520 poisha  (৳115.20)
 */
export const RATE_CARD = {
  currency: 'BDT',
  /** Flag-down charge per seat. */
  baseFarePoisha: 6_000,
  /** Distance charge per seat per kilometre. */
  ratePerKmPoisha: 1_200,
  /** Pool discount applied to the subtotal when ≥ 2 members complete the trip. */
  poolDiscountPercent: 20,
  /** Floor guard; unreachable under the current rates (documented so rate changes stay safe). */
  minFarePoisha: 5_000,
} as const;

export type RateCard = typeof RATE_CARD;
