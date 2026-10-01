/**
 * `FareCard` (ui-ux §6) — `৳` display plus the poisha breakdown
 * (`base + distance − pool discount`) and the honest note that the discount
 * assumes 2+ passengers complete the trip (PRD §12).
 *
 * Money is rendered through `formatBdt` and the raw integer is kept on
 * `data-poisha` (ui-ux §8), so an evaluator can read 11520 straight off the DOM
 * while a human sees ৳115.20.
 */

import { POOL_DISCOUNT_NOTE, formatBdt, seatsLabel } from '@/lib/format';
import { DataList, DataRow, StatusChip } from '@/components/ui';
import type { FareEstimate } from '@/lib/types';

export function FareCard({
  estimate,
  seats,
  title = 'Estimated fare',
}: {
  estimate: FareEstimate;
  seats: number;
  title?: string;
}) {
  return (
    <section className="surface p-5 sm:p-6" data-fare-status="ESTIMATE">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-sm shadow-brand-700/20">
        <p className="text-3xl font-bold tracking-tight" data-poisha={estimate.totalDuePoisha}>
          {formatBdt(estimate.totalDuePoisha)}
        </p>
        <p className="mt-1 text-sm text-white/80">
          {seatsLabel(seats)} · {formatBdt(estimate.perSeatPoisha)} per seat · {estimate.distanceKm}{' '}
          km
        </p>
      </div>

      <div className="mt-4">
        <DataList>
          <DataRow label="Base fare">{formatBdt(estimate.baseFarePoisha)}</DataRow>
          <DataRow label={`Distance (${estimate.distanceKm} km)`}>
            {formatBdt(estimate.distanceChargePoisha)}
          </DataRow>
          <DataRow label="Subtotal">{formatBdt(estimate.subtotalPoisha)}</DataRow>
          <DataRow label={`Pool discount (${estimate.poolDiscountPercent}%)`}>
            <span className="text-brand-700">−{formatBdt(estimate.estimatedDiscountPoisha)}</span>
          </DataRow>
          <DataRow label={`Total (${seatsLabel(seats)})`}>
            <span data-poisha={estimate.totalDuePoisha}>{formatBdt(estimate.totalDuePoisha)}</span>
          </DataRow>
        </DataList>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        {POOL_DISCOUNT_NOTE}. Without another passenger the fare is{' '}
        {formatBdt(estimate.subtotalPoisha)}.
      </p>
    </section>
  );
}

/** The stored row from `GET /rides/:id` — `ESTIMATED` while live, `FINAL` once the pool completes. */
export interface StoredFare {
  status: string;
  baseFarePoisha: number;
  distanceChargePoisha: number;
  subtotalPoisha: number;
  poolDiscountPoisha: number;
  totalPoisha: number;
  currency: string;
}

/**
 * The same card, drawn from the persisted fare instead of an estimate: the ride
 * detail shows exactly what the database holds (FR-FARE-003/004 — the number the
 * passenger will be charged, and whether it is still an estimate).
 */
export function FareBreakdown({
  fare,
  distanceKm,
}: {
  fare: StoredFare;
  distanceKm: number | null;
}) {
  const discounted = fare.poolDiscountPoisha > 0;

  return (
    <div data-fare-status={fare.status}>
      <div className="flex items-baseline justify-between gap-3">
        <p
          className="text-3xl font-bold tracking-tight text-ink-900"
          data-poisha={fare.totalPoisha}
        >
          {formatBdt(fare.totalPoisha)}
        </p>
        <StatusChip
          status={fare.status}
          label={fare.status === 'FINAL' ? 'Final fare' : 'Estimated fare'}
        />
      </div>

      <div className="mt-4">
        <DataList>
          <DataRow label="Base fare">{formatBdt(fare.baseFarePoisha)}</DataRow>
          <DataRow label={distanceKm === null ? 'Distance' : `Distance (${distanceKm} km)`}>
            {formatBdt(fare.distanceChargePoisha)}
          </DataRow>
          <DataRow label="Subtotal">{formatBdt(fare.subtotalPoisha)}</DataRow>
          <DataRow label="Pool discount">
            {discounted ? (
              <span className="text-brand-700">−{formatBdt(fare.poolDiscountPoisha)}</span>
            ) : (
              <span className="text-ink-400">{formatBdt(0)}</span>
            )}
          </DataRow>
          <DataRow label="Total">
            <span data-poisha={fare.totalPoisha}>{formatBdt(fare.totalPoisha)}</span>
          </DataRow>
        </DataList>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        {fare.status === 'FINAL'
          ? discounted
            ? 'Final: the group discount applied, so 2+ passengers completed the trip.'
            : 'Final: completed solo, so no pool discount applied.'
          : POOL_DISCOUNT_NOTE + '.'}
      </p>
    </div>
  );
}
