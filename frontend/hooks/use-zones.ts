'use client';

/**
 * `GET /zones` for the request form's dropdowns — the one endpoint that is
 * callable mid-session and changes almost never, so it is fetched once per screen
 * and never polled.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchZones } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import type { Zone } from '@/lib/types';

export interface ZonesState {
  zones: Zone[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useZones(): ZonesState {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const list = await fetchZones();
        if (!cancelled) setZones(list);
      } catch (caught) {
        if (!cancelled) setError(messageForError(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { zones, loading, error, reload };
}
