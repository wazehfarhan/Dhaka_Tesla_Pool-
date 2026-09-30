/**
 * `PollIndicator` (ui-ux §6/§7) — a subtle "live" dot while a screen polls every
 * 3 s, which turns amber when a poll fails. It never replaces the last known
 * state: the screen keeps showing the last successful payload and says so.
 */

export function PollIndicator({
  failed,
  label = 'live · updates every 3 s',
}: {
  failed: boolean;
  label?: string;
}) {
  return (
    <p
      aria-live="polite"
      data-poll-state={failed ? 'failed' : 'ok'}
      className={`inline-flex items-center gap-2 text-xs ${failed ? 'text-amber-700' : 'text-slate-500'}`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${failed ? 'bg-amber-500' : 'bg-emerald-500'}`}
      />
      {failed ? 'reconnecting · showing the last update' : label}
    </p>
  );
}
