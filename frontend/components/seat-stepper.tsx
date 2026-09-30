/**
 * `SeatStepper` (ui-ux §6) — `1 … poolAvailableSeats`, "never above remaining
 * capacity, disabled values explained".
 *
 * The ceiling and the explanation both come from `POST /fare/estimate`
 * (`seatCapacity` is Bullet's 3, `poolAvailableSeats` is what is left in the
 * corridor's OPEN pool).
 */

import { Button } from '@/components/ui';

export function SeatStepper({
  seats,
  maxSeats,
  seatCapacity,
  onChange,
  disabled = false,
}: {
  seats: number;
  maxSeats: number;
  seatCapacity: number;
  onChange: (seats: number) => void;
  disabled?: boolean;
}) {
  const atMax = seats >= maxSeats;
  const atMin = seats <= 1;

  return (
    <div className="text-sm">
      <span className="block text-slate-700" id="seats-label">
        Seats
      </span>

      <div
        className="mt-1 inline-flex items-center gap-2"
        role="group"
        aria-labelledby="seats-label"
        data-seats={seats}
        data-pool-available-seats={maxSeats}
      >
        <Button
          type="button"
          variant="secondary"
          aria-label="Remove one seat"
          disabled={disabled || atMin}
          onClick={() => onChange(seats - 1)}
        >
          −
        </Button>
        <output className="min-w-8 text-center text-base font-medium text-slate-900">
          {seats}
        </output>
        <Button
          type="button"
          variant="secondary"
          aria-label="Add one seat"
          disabled={disabled || atMax}
          onClick={() => onChange(seats + 1)}
        >
          +
        </Button>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {maxSeats} of {seatCapacity} seats left on this route
        {atMax && maxSeats > 0 ? ' — that is the most one passenger can hold.' : '.'}
      </p>

      {maxSeats === 0 && (
        <p className="mt-1 text-xs text-amber-700">
          Bullet is full on this route, so seats cannot be added.
        </p>
      )}
    </div>
  );
}
