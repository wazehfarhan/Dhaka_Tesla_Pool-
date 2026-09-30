import { RATE_CARD } from '../../config/rate-card.js';
import type { Database } from '../../db/client.js';
import {
  AppError,
  NotFoundError,
  SameZoneError,
  ValidationError,
  ZoneNotFoundError,
} from '../../shared/errors.js';
import { createFareRepository, type FarePersistenceClient } from './fare.repository.js';
import type { FareEstimateInput } from './fare.schemas.js';
import type { FareBreakdown, FareEstimateResponse } from './fare.types.js';

/**
 * Fare domain — PRD §12, requirements FR-FARE-001…004.
 *
 * The maths below is pure and integer-only: `config/rate-card.ts` is the single
 * source of truth (A-03), amounts are poisha integers, and the only rounding
 * step (the percentage discount) floors via integer arithmetic — no float ever
 * touches the money path (FR-FARE-003).
 */

/** The estimate always assumes a shared trip — the discount is honest, not guaranteed (api.md §4). */
const ASSUMES_POOL_SIZE = 2;

/** `floor(numerator ÷ denominator)` without leaving integer arithmetic (numerators are ≥ 0). */
function integerFloorRatio(numerator: number, denominator: number): number {
  return (numerator - (numerator % denominator)) / denominator;
}

/** subtotal = BASE_FARE + distance_km × RATE_PER_KM (PRD §12.2). */
export function computeSubtotalPoisha(distanceKm: number): number {
  return RATE_CARD.baseFarePoisha + distanceKm * RATE_CARD.ratePerKmPoisha;
}

/** poolDiscount = floor(subtotal × percent ÷ 100) — the one rounding step, always down. */
export function computePoolDiscountPoisha(
  subtotalPoisha: number,
  percent: number = RATE_CARD.poolDiscountPercent,
): number {
  return integerFloorRatio(subtotalPoisha * percent, 100);
}

/** perSeat = max(MIN_FARE, subtotal − discount) — the floor guard (PRD §12.1). */
export function computePerSeatPoisha(subtotalPoisha: number, poolDiscountPoisha: number): number {
  return Math.max(RATE_CARD.minFarePoisha, subtotalPoisha - poolDiscountPoisha);
}

function assertFareInputs(distanceKm: number, seats: number, activeCompleters?: number): void {
  if (!Number.isInteger(distanceKm) || distanceKm < 1) {
    throw new ValidationError('distanceKm must be a positive integer.');
  }
  if (!Number.isInteger(seats) || seats < 1) {
    throw new ValidationError('seats must be a positive integer.');
  }
  if (
    activeCompleters !== undefined &&
    (!Number.isInteger(activeCompleters) || activeCompleters < 0)
  ) {
    throw new ValidationError('activeCompleters must be a non-negative integer.');
  }
}

function buildBreakdown(
  distanceKm: number,
  seats: number,
  poolDiscountPoisha: number,
): FareBreakdown {
  const distanceChargePoisha = distanceKm * RATE_CARD.ratePerKmPoisha;
  const subtotalPoisha = RATE_CARD.baseFarePoisha + distanceChargePoisha;
  const perSeatPoisha = computePerSeatPoisha(subtotalPoisha, poolDiscountPoisha);
  return {
    distanceKm,
    baseFarePoisha: RATE_CARD.baseFarePoisha,
    distanceChargePoisha,
    subtotalPoisha,
    poolDiscountPercent: RATE_CARD.poolDiscountPercent,
    poolDiscountPoisha,
    perSeatPoisha,
    // FR-FARE-002: the passenger pays per-seat fare × seats.
    totalDuePoisha: perSeatPoisha * seats,
    currency: RATE_CARD.currency,
  };
}

/**
 * Pre-request estimate — FR-FARE-001. Always applies the pool discount because
 * the estimate *assumes* ≥ 2 completers (`assumesPoolSize: 2`); a solo trip
 * finalizes without it (PRD §12.3).
 */
export function estimateFare(distanceKm: number, seats: number): FareBreakdown {
  assertFareInputs(distanceKm, seats);
  const subtotalPoisha = computeSubtotalPoisha(distanceKm);
  return buildBreakdown(distanceKm, seats, computePoolDiscountPoisha(subtotalPoisha));
}

/**
 * Final fare at pool completion — FR-FARE-002: the discount applies **iff**
 * ≥ 2 active members complete the trip; a solo completion pays the full
 * subtotal (৳144.00 for Banani → Dhanmondi).
 */
export function finalizeFare(
  distanceKm: number,
  seats: number,
  activeCompleters: number,
): FareBreakdown {
  assertFareInputs(distanceKm, seats, activeCompleters);
  const subtotalPoisha = computeSubtotalPoisha(distanceKm);
  const poolDiscountPoisha = activeCompleters >= 2 ? computePoolDiscountPoisha(subtotalPoisha) : 0;
  return buildBreakdown(distanceKm, seats, poolDiscountPoisha);
}

export interface FareService {
  /** `POST /fare/estimate` business rules (api.md §4). */
  getEstimate(input: FareEstimateInput): Promise<FareEstimateResponse>;
  /**
   * Persist the `ESTIMATED` fare row — architecture §6 step 7 (wired by
   * POST /rides). The optional transaction client joins the caller's
   * transaction when given; without one the write uses the root client.
   */
  saveEstimate(
    rideRequestId: string,
    distanceKm: number,
    seats: number,
    tx?: FarePersistenceClient,
  ): Promise<FareBreakdown>;
  /** Write the `FINAL` fare once — called from the pool-completion transaction (Phase 5). */
  finalizeRideFare(
    rideRequestId: string,
    activeCompleters: number,
    tx?: FarePersistenceClient,
  ): Promise<FareBreakdown>;
}

export function createFareService({ database }: { database?: Database }): FareService {
  function prisma() {
    // Honest failure: no database → 500, never a fabricated fare.
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database.prisma;
  }

  return {
    async getEstimate({
      pickupZone,
      destinationZone,
      seats,
    }: FareEstimateInput): Promise<FareEstimateResponse> {
      const fares = createFareRepository(prisma());

      if (pickupZone.toLowerCase() === destinationZone.toLowerCase()) throw new SameZoneError();

      const pickup = await fares.findZoneByName(pickupZone);
      const destination = await fares.findZoneByName(destinationZone);
      if (!pickup || !destination) throw new ZoneNotFoundError();

      const route = await fares.findDistance(pickup.id, destination.id);
      if (!route) throw new ZoneNotFoundError('No recorded distance between the selected zones.');

      // Capacity: the corridor's OPEN pool snapshot, else the seeded vehicle's.
      // poolAvailableSeats lets the UI cap the seat picker (D-07); the atomic
      // re-check against the *current* free seats still happens on POST /rides.
      const openPool = await fares.findOpenPool(pickup.id, destination.id);
      let seatCapacity: number;
      let poolAvailableSeats: number;
      if (openPool) {
        seatCapacity = openPool.seatCapacity;
        poolAvailableSeats = openPool.seatCapacity - openPool.seatsTaken;
      } else {
        const vehicle = await fares.findServiceVehicle();
        if (!vehicle) {
          throw new AppError(
            'NO_VEHICLE_AVAILABLE',
            'No vehicle is available to serve this corridor.',
          );
        }
        seatCapacity = vehicle.seatCapacity;
        poolAvailableSeats = seatCapacity;
      }

      if (seats > seatCapacity) {
        throw new ValidationError(`seats must be between 1 and ${seatCapacity} for this vehicle.`);
      }

      const fare = estimateFare(route.distanceKm, seats);
      return {
        distanceKm: fare.distanceKm,
        baseFarePoisha: fare.baseFarePoisha,
        distanceChargePoisha: fare.distanceChargePoisha,
        subtotalPoisha: fare.subtotalPoisha,
        poolDiscountPercent: fare.poolDiscountPercent,
        estimatedDiscountPoisha: fare.poolDiscountPoisha,
        perSeatPoisha: fare.perSeatPoisha,
        totalDuePoisha: fare.totalDuePoisha,
        currency: fare.currency,
        assumesPoolSize: ASSUMES_POOL_SIZE,
        seatCapacity,
        poolAvailableSeats,
      };
    },

    async saveEstimate(
      rideRequestId: string,
      distanceKm: number,
      seats: number,
      tx?: FarePersistenceClient,
    ): Promise<FareBreakdown> {
      const fare = estimateFare(distanceKm, seats);
      await createFareRepository(tx ?? prisma()).createFare({
        rideRequestId,
        distanceKm: fare.distanceKm,
        baseFarePoisha: fare.baseFarePoisha,
        distanceChargePoisha: fare.distanceChargePoisha,
        subtotalPoisha: fare.subtotalPoisha,
        poolDiscountPoisha: fare.poolDiscountPoisha,
        totalPoisha: fare.totalDuePoisha,
        currency: fare.currency,
      });
      return fare;
    },

    /**
     * FR-FARE-002 finalization — `tx?` lets pool completion run it inside the
     * driver's transition transaction (api.md §6.4: fares finalize and payments
     * are created atomically with the status flip). Outside a transaction the
     * root client is used, exactly as before.
     */
    async finalizeRideFare(
      rideRequestId: string,
      activeCompleters: number,
      tx?: FarePersistenceClient,
    ): Promise<FareBreakdown> {
      const fares = createFareRepository(tx ?? prisma());
      const row = await fares.findFareByRideRequestId(rideRequestId);
      if (!row) throw new NotFoundError('Fare not found for this ride.');
      const ride = await fares.findRideRequest(rideRequestId);
      if (!ride) throw new NotFoundError('Ride not found.');

      const fare = finalizeFare(row.distanceKm, ride.seats, activeCompleters);

      // FR-FARE-004: written exactly once (ESTIMATED → FINAL). A replayed call
      // returns the stored values untouched instead of rewriting the row.
      if (row.status === 'FINAL') {
        return {
          distanceKm: row.distanceKm,
          baseFarePoisha: row.baseFarePoisha,
          distanceChargePoisha: row.distanceChargePoisha,
          subtotalPoisha: row.subtotalPoisha,
          poolDiscountPercent: RATE_CARD.poolDiscountPercent,
          poolDiscountPoisha: row.poolDiscountPoisha,
          perSeatPoisha: row.totalPoisha / ride.seats,
          totalDuePoisha: row.totalPoisha,
          currency: row.currency,
        };
      }

      await fares.updateFare(row.id, {
        status: 'FINAL',
        poolDiscountPoisha: fare.poolDiscountPoisha,
        totalPoisha: fare.totalDuePoisha,
        finalizedAt: new Date(),
      });
      return fare;
    },
  };
}
