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
      className={`inline-flex items-center gap-2 rounded-full border border-ink-900/5 bg-white/70 px-2.5 py-1 text-xs font-medium ${failed ? 'text-amber-700' : 'text-ink-500'}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${failed ? 'bg-amber-500' : 'bg-brand-500'}`}
      />
      {failed ? 'reconnecting · showing the last update' : label}
    </p>
  );
}
