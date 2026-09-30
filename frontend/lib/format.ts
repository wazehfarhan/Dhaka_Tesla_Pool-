/**
 * Display helpers — ui-ux §8 is literal about money: "Currency always rendered
 * `৳115.20` (never raw `11520`) with the integer available in the DOM `data-`
 * attribute for the evaluator."
 *
 * The maths stays in integer poisha all the way to the string (ADR-003): no
 * `toFixed`, no floats, no `Intl.NumberFormat` on a value that could drift.
 */

/** `11520` → `৳115.20`. Integer-only: taka and paisa are split with `%`, not division. */
export function formatBdt(poisha: number): string {
  const negative = poisha < 0;
  const abs = Math.abs(Math.trunc(poisha));
  const taka = Math.trunc(abs / 100);
  const paisa = abs % 100;
  return `${negative ? '-' : ''}৳${taka}.${String(paisa).padStart(2, '0')}`;
}

/** Human timestamp for history rows and timelines. Client-side only (no SSR/hydration drift). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Any pooled fare assumes a shared trip — the 20% only holds if ≥ 2 complete (PRD §12). */
export const POOL_DISCOUNT_NOTE = 'Assumes 2+ passengers complete the trip';

interface StatusCopy {
  label: string;
  /** The sentence the dashboard shows for the passenger's current ride. */
  detail: string;
}

/**
 * Status → human copy, in one table. ui-ux §3/§5 forbid raw enum values on
 * screen, and the same words must be reused by the timeline, the dashboard card
 * and the driver screens (Phase 5), so they live here rather than inline.
 */
const STATUS_COPY: Record<string, StatusCopy> = {
  REQUESTED: { label: 'Seeking a driver', detail: 'Seats held. Finding your driver.' },
  ACCEPTED: { label: 'Driver on the way', detail: 'Your driver accepted and is on the way.' },
  DRIVER_ARRIVED: { label: 'Driver arrived', detail: 'Your driver has arrived.' },
  STARTED: { label: 'Trip in progress', detail: 'On the way to your destination.' },
  COMPLETED: { label: 'Completed', detail: 'Trip complete — the fare is final.' },
  CANCELLED: { label: 'Cancelled', detail: 'This ride was cancelled and the seat released.' },
};

const UNKNOWN_STATUS: StatusCopy = {
  label: 'Unknown',
  detail: 'This ride is in an unexpected state.',
};

export function statusLabel(status: string): string {
  return (STATUS_COPY[status] ?? UNKNOWN_STATUS).label;
}

export function statusDetail(status: string): string {
  return (STATUS_COPY[status] ?? UNKNOWN_STATUS).detail;
}

/** Terminal states end the story: no polling, no cancel, no further transitions. */
export function isTerminal(status: string): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/**
 * The four non-terminal ride states, mirroring the backend's
 * `ACTIVE_RIDE_STATUSES` (matching.repository.ts) which drives `409
 * ACTIVE_RIDE_EXISTS`. The dashboard uses it to pick "the ride in progress"
 * out of the list, so the two definitions must stay in step.
 */
const ACTIVE_RIDE_STATUSES = new Set(['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED']);

export function isActiveRide(status: string): boolean {
  return ACTIVE_RIDE_STATUSES.has(status);
}

/** The happy path the timeline renders; `CANCELLED` is handled as a branch. */
export const RIDE_PROGRESSION: readonly string[] = [
  'REQUESTED',
  'ACCEPTED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
];

/** Seats label that never prints a bare number where prose reads better. */
export function seatsLabel(seats: number): string {
  return seats === 1 ? '1 seat' : `${seats} seats`;
}
