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
    <ol className="space-y-0" data-ride-status={status}>
      {RIDE_PROGRESSION.map((step, index) => {
        const reached = !cancelled && currentIndex >= index;
        const current = !cancelled && currentIndex === index;
        const at = timeline.find((entry) => entry.toStatus === step)?.createdAt;

        return (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                reached ? 'bg-emerald-600' : 'bg-slate-300'
              } ${current ? 'ring-4 ring-emerald-100' : ''}`}
            />
            <div className="pb-4">
              <p
                aria-current={current ? 'step' : undefined}
                className={
                  reached ? 'text-sm font-medium text-slate-900' : 'text-sm text-slate-500'
                }
              >
                {statusLabel(step)}
                {current && <span className="ml-2 text-xs font-normal text-emerald-700">now</span>}
              </p>
              {at !== undefined && <p className="text-xs text-slate-500">{formatDateTime(at)}</p>}
            </div>
          </li>
        );
      })}

      {cancelled && (
        <li className="flex gap-3" data-status="CANCELLED">
          <span
            aria-hidden
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400 ring-4 ring-slate-100"
          />
          <div>
            <p aria-current="step" className="text-sm font-medium text-slate-900">
              {statusLabel('CANCELLED')}
              <span className="ml-2 text-xs font-normal text-slate-600">now</span>
            </p>
            {cancelledAt !== undefined && (
              <p className="text-xs text-slate-500">{formatDateTime(cancelledAt)}</p>
            )}
          </div>
        </li>
      )}
    </ol>
  );
}
