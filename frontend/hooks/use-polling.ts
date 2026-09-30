'use client';

/**
 * Polling hook — ui-ux §7: "active screens poll every 3 s with backoff on
 * failure, pausing when the tab is hidden".
 *
 * Deliberately tiny and dependency-free: the fetch is passed in, the hook owns
 * the schedule. It never fires while a previous fetch is in flight, and it stops
 * for good when `enabled` goes false (a completed or cancelled ride).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const BASE_INTERVAL_MS = 3_000;
const MAX_INTERVAL_MS = 30_000;

export interface PollingState {
  /** True while a fetch is in flight (used by the PollIndicator). */
  isRefreshing: boolean;
  /** Set when the last attempt threw; cleared by the next success. */
  failed: boolean;
  /** Force an immediate (un-scheduled) refresh — used after a mutation. */
  refresh: () => void;
}

export function usePolling(enabled: boolean, fetchOnce: () => Promise<void>): PollingState {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  // Refs keep the timers stable across renders without re-subscribing the effect.
  const fetchRef = useRef(fetchOnce);
  const inFlightRef = useRef(false);
  const backoffRef = useRef(BASE_INTERVAL_MS);

  useEffect(() => {
    fetchRef.current = fetchOnce;
  }, [fetchOnce]);

  const run = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await fetchRef.current();
      backoffRef.current = BASE_INTERVAL_MS;
      setFailed(false);
    } catch {
      // Keep the last known state on screen and slow the cadence down (ui-ux §7).
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_INTERVAL_MS);
      setFailed(true);
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        // A hidden tab does not poll — the next visible tick catches up (ui-ux §7).
        if (!document.hidden) await run();
        if (!cancelled) schedule(backoffRef.current);
      }, delay);
    };

    const onVisibility = () => {
      if (!document.hidden) {
        // Coming back to the tab: refresh immediately instead of waiting a full interval.
        clearTimeout(timer);
        void run().then(() => {
          if (!cancelled) schedule(backoffRef.current);
        });
      }
    };

    void run();
    schedule(backoffRef.current);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, run, tick]);

  return { isRefreshing, failed, refresh };
}
