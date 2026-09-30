/**
 * Fare value objects — PRD §12 / requirements FR-FARE-001…004.
 *
 * Every monetary field is an integer number of POISHA (1 BDT = 100 poisha,
 * ADR-003). `FareBreakdown` is what the pure math produces (estimate and
 * finalize alike); `FareEstimateResponse` is the exact `POST /fare/estimate`
 * payload from api.md §4.
 */

/** The pure result of the rate-card maths for one ride. */
export interface FareBreakdown {
  distanceKm: number;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPercent: number;
  /** The discount actually applied (0 for a solo completion). */
  poolDiscountPoisha: number;
  /** What one seat costs. */
  perSeatPoisha: number;
  /** `perSeatPoisha × seats` — the passenger's total due (FR-FARE-002). */
  totalDuePoisha: number;
  currency: string;
}

/** The documented estimate response, key for key (api.md §4, D-07). */
export interface FareEstimateResponse {
  distanceKm: number;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPercent: number;
  estimatedDiscountPoisha: number;
  perSeatPoisha: number;
  totalDuePoisha: number;
  currency: string;
  /** The estimate assumes a shared trip — the 20% discount iff ≥ 2 complete. */
  assumesPoolSize: number;
  /** Bullet's fixed seat capacity — lets the UI cap the seat picker (D-07). */
  seatCapacity: number;
  /** Free seats in the corridor's OPEN pool, or the full capacity without one. */
  poolAvailableSeats: number;
}
