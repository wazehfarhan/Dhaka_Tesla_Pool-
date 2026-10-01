'use client';

/**
 * `/driver/history` — completed and cancelled trips (FR-HISTORY-002).
 *
 * The same `GET /driver/pools?status=` endpoint serves this screen and the
 * Requests queue (api.md §6.1); only the filter differs, which is the point of
 * that design: one query, three views, no client-side re-derivation of history.
 *
 * Unlike the dashboard this screen does **not** poll: a finished trip cannot
 * change, and ui-ux §7 only asks live screens to poll.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Notice,
  PageHeading,
  RouteLine,
  Skeleton,
  Stat,
  StatusChip,
} from '@/components/ui';
import { fetchDriverPools } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import { formatDateTime, poolStatusLabel, seatsLabel } from '@/lib/format';
import type { DriverPoolListItem } from '@/lib/types';

/** `COMPLETED` and `CANCELLED` are both "history" to a driver (api.md §6.1). */
const HISTORY_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

export default function DriverHistoryPage() {
  const [pools, setPools] = useState<DriverPoolListItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Both filters are read in parallel; the list merges them in one render.
      const [completed, cancelled] = await Promise.all(
        HISTORY_STATUSES.map((status) => fetchDriverPools({ status, limit: 50 })),
      );
      const merged = [...completed.pools, ...cancelled.pools].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      setPools(merged);
      setReady(true);
      setError(null);
    } catch (caught) {
      setReady(true);
      setError(messageForError(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = !ready && error === null;
  // Collected totals are what the driver actually wants from history (PRD §7).
  const collectedPoisha = pools
    .filter((pool) => pool.status === 'COMPLETED')
    .reduce((total, pool) => total + pool.seatsTaken, 0);

  return (
    <div className="space-y-4">
      <PageHeading
        title="Trip history"
        description="Completed and cancelled trips, newest first."
        actions={
          <Link href="/driver">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        }
      />

      {error !== null && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading && (
        <Card>
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Card>
      )}

      {!loading && pools.length === 0 && (
        <EmptyState
          title="No trips yet"
          description="Completed and cancelled trips will be listed here with their collected fares."
        />
      )}

      {!loading && pools.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Trips on record" value={pools.length} />
            <Stat
              label="Seats carried"
              value={collectedPoisha}
              hint="Passenger seats on completed trips"
              tone="brand"
            />
            <Stat
              label="Cancelled"
              value={pools.filter((pool) => pool.status === 'CANCELLED').length}
            />
          </div>

          <Notice tone="info">
            Every passenger is charged their own fare on their own ride, so the money settles per
            ride rather than per trip.
          </Notice>

          <Card>
            <ul className="divide-y divide-ink-900/5 text-sm">
              {pools.map((pool) => (
                <li
                  key={pool.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                >
                  <div>
                    <Link
                      className="font-semibold text-ink-900 hover:text-brand-700"
                      href={`/driver/pools/${pool.id}`}
                    >
                      <RouteLine from={pool.pickupZone} to={pool.destinationZone} />
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatDateTime(pool.createdAt)} · {pool.seatsTaken}/{pool.seatCapacity} ·{' '}
                      {seatsLabel(pool.seatsTaken)} carried
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-500">
                      {pool.members.map((member) => member.passenger).join(', ')}
                    </span>
                    <StatusChip status={pool.status} label={poolStatusLabel(pool.status)} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
