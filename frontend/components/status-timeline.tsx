/**
 * `StatusTimeline` (ui-ux §6) — the REQUESTED → … → COMPLETED ladder with the
 * current step highlighted, reused by the ride detail (and, in Phase 5, the
 * driver pool detail).
 *
 * Times come straight from the API's `ride_status_history` trail, so a step only
 * shows a timestamp if the backend actually recorded that transition — the UI
 * never invents progress.
 */

import { RIDE_PROGRESSION, formatDateTime, statusLabel } from '@/lib/format';

export interface TimelineEntry {
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

export function StatusTimeline({
  status,
  timeline,
}: {
  status: string;
  timeline: TimelineEntry[];
}) {
  const cancelled = status === 'CANCELLED';
  const currentIndex = RIDE_PROGRESSION.indexOf(status);
  const cancelledAt = timeline.find((entry) => entry.toStatus === 'CANCELLED')?.createdAt;

  return (
    <ol className="relative space-y-0" data-ride-status={status}>
      {/* One continuous rail behind the dots: the ladder reads as a single path. */}
      <span aria-hidden className="absolute left-[5px] top-2 bottom-6 w-px bg-ink-900/10" />
      {RIDE_PROGRESSION.map((step, index) => {
        const reached = !cancelled && currentIndex >= index;
        const current = !cancelled && currentIndex === index;
        const at = timeline.find((entry) => entry.toStatus === step)?.createdAt;

        return (
          <li key={step} className="relative flex gap-3.5">
            <span
              aria-hidden
              className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white ${
                reached ? 'bg-brand-600' : 'bg-ink-900/15'
              } ${current ? 'ring-brand-100' : ''}`}
            />
            <div className="pb-5 last:pb-0">
              <p
                aria-current={current ? 'step' : undefined}
                className={reached ? 'text-sm font-semibold text-ink-900' : 'text-sm text-ink-400'}
              >
                {statusLabel(step)}
                {current && (
                  <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                    now
                  </span>
                )}
              </p>
              {at !== undefined && (
                <p className="mt-0.5 text-xs text-ink-500">{formatDateTime(at)}</p>
              )}
            </div>
          </li>
        );
      })}

      {cancelled && (
        <li className="relative flex gap-3.5" data-status="CANCELLED">
          <span
            aria-hidden
            className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-ink-400 ring-4 ring-ink-100"
          />
          <div>
            <p aria-current="step" className="text-sm font-semibold text-ink-900">
              {statusLabel('CANCELLED')}
              <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                now
              </span>
            </p>
            {cancelledAt !== undefined && (
              <p className="mt-0.5 text-xs text-ink-500">{formatDateTime(cancelledAt)}</p>
            )}
          </div>
        </li>
      )}
    </ol>
  );
}
