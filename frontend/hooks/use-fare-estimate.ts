'use client';

/**
 * The live fare behind the request form (ui-ux §3: "View Fare — live estimate
 * from POST /fare/estimate").
 *
 * Debounced because the estimate is recomputed on every keystroke of the seat
 * stepper and every zone change, and an in-flight estimate can be superseded —
 * only the newest request is allowed to write state (a stale response must never
 * overwrite a newer fare).
 *
 * `SAME_ZONE` is never sent: the form blocks it client-side (ui-ux §6), so the
 * hook is not asked to estimate an impossible corridor.
 */

import { useEffect, useState } from 'react';
import { estimateFare } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import type { EstimateInput } from '@/lib/api';
import type { FareEstimate } from '@/lib/types';

const DEBOUNCE_MS = 350;

export interface FareEstimateState {
  estimate: FareEstimate | null;
  /** True when both zones are chosen and no local validation blocks the call. */
  loading: boolean;
  error: string | null;
  /** Bumped after a mutation so the screen can refresh the seat ceiling. */
  reload: () => void;
}

export function useFareEstimate(input: {
  pickupZone: string;
  destinationZone: string;
  seats: number;
}): FareEstimateState {
  const { pickupZone, destinationZone, seats } = input;

  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const ready = pickupZone !== '' && destinationZone !== '' && pickupZone !== destinationZone;

  useEffect(() => {
    if (!ready) {
      setEstimate(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      const payload: EstimateInput = { pickupZone, destinationZone, seats };
      try {
        const result = await estimateFare(payload);
        if (!cancelled) setEstimate(result);
      } catch (caught) {
        if (!cancelled) {
          setEstimate(null);
          setError(messageForError(caught));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, pickupZone, destinationZone, seats, attempt]);

  return { estimate, loading, error, reload: () => setAttempt((value) => value + 1) };
}
