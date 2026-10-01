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
      <span className="block font-medium text-ink-700" id="seats-label">
        Seats
      </span>

      <div
        className="mt-1.5 inline-flex items-center gap-1 rounded-2xl border border-ink-900/10 bg-white p-1 shadow-xs"
        role="group"
        aria-labelledby="seats-label"
        data-seats={seats}
        data-pool-available-seats={maxSeats}
      >
        <Button
          type="button"
          variant="ghost"
          aria-label="Remove one seat"
          className="h-9 w-9 rounded-xl px-0 text-lg"
          disabled={disabled || atMin}
          onClick={() => onChange(seats - 1)}
        >
          −
        </Button>
        <output className="min-w-10 text-center text-lg font-bold tracking-tight text-ink-900">
          {seats}
        </output>
        <Button
          type="button"
          variant="ghost"
          aria-label="Add one seat"
          className="h-9 w-9 rounded-xl px-0 text-lg"
          disabled={disabled || atMax}
          onClick={() => onChange(seats + 1)}
        >
          +
        </Button>
      </div>

      <p className="mt-2 text-xs text-ink-500">
        {maxSeats} of {seatCapacity} seats left on this route
        {atMax && maxSeats > 0 ? ' — that is the most one passenger can hold.' : '.'}
      </p>

      {maxSeats === 0 && (
        <p className="mt-1 text-xs font-medium text-amber-700">
          This route is full, so no more seats can be added.
        </p>
      )}
    </div>
  );
}
