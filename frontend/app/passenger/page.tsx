'use client';

/**
 * `/passenger` — the dashboard (ui-ux §2/§3): "active ride card or empty state +
 * Request ride CTA", with recent rides beside it on desktop (ui-ux §8: "desktop
 * adds a two-column dashboard (active ride | history)").
 *
 * The list is polled every 3 s (ui-ux §7), which is also how the dashboard learns
 * that Jashim accepted: the ride row's status changes and every sentence on this
 * screen is derived from it — nothing here is cached or guessed.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { PollIndicator } from '@/components/poll-indicator';
import { useAuth } from '@/components/auth-provider';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeading,
  Skeleton,
  StatusChip,
} from '@/components/ui';
import { usePolling } from '@/hooks/use-polling';
import { fetchRides } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import {
  formatBdt,
  formatDateTime,
  isActiveRide,
  seatsLabel,
  statusDetail,
  statusLabel,
} from '@/lib/format';
import type { RideListItem } from '@/lib/types';

const RECENT_LIMIT = 5;

interface DashboardState {
  rides: RideListItem[];
  total: number;
  ready: boolean;
  error: string | null;
}

export default function PassengerDashboardPage() {
  const { user } = useAuth();
  const [state, setState] = useState<DashboardState>({
    rides: [],
    total: 0,
    ready: false,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const page = await fetchRides({ limit: 20 });
      setState({ rides: page.rides, total: page.meta.total, ready: true, error: null });
    } catch (caught) {
      // Keep the last known ride on screen; the banner and poll dot report the failure.
      setState((current) => ({ ...current, error: messageForError(caught) }));
      throw caught;
    }
  }, []);

  const { failed, refresh } = usePolling(true, load);

  const activeRide = state.rides.find((ride) => isActiveRide(ride.status)) ?? null;
  const recentRides = state.rides
    .filter((ride) => ride.id !== activeRide?.id)
    .slice(0, RECENT_LIMIT);
  const loading = !state.ready && state.error === null;

  return (
    <div className="space-y-6">
      <PageHeading
        title={`Hello, ${user?.name ?? 'passenger'}`}
        description="One Tesla, three seats. Your ride, your seat, your fare."
        actions={
          <div className="flex items-center gap-3">
            <PollIndicator failed={failed} />
            <Link href="/passenger/request-ride">
              <Button>Request a ride</Button>
            </Link>
          </div>
        }
      />

      {state.error !== null && <ErrorBanner message={state.error} onRetry={refresh} />}

      <div className="grid gap-6 md:grid-cols-2">
        <CurrentRideColumn loading={loading} activeRide={activeRide} />
        <RecentRidesColumn
          loading={loading}
          rides={recentRides}
          total={state.total}
          hasActive={activeRide !== null}
        />
      </div>
    </div>
  );
}

/** "Current ride" — the card the whole demo watches: status, seats held, live fare. */
function CurrentRideColumn({
  loading,
  activeRide,
}: {
  loading: boolean;
  activeRide: RideListItem | null;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-600">Current ride</h2>

      {loading && (
        <Card>
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        </Card>
      )}

      {!loading && activeRide === null && (
        <EmptyState
          title="No active ride"
          description="Request one and we will hold a seat while a driver is found."
          action={
            <Link href="/passenger/request-ride">
              <Button>Request a ride</Button>
            </Link>
          }
        />
      )}

      {!loading && activeRide !== null && (
        <Card
          title="Current ride"
          actions={<StatusChip status={activeRide.status} label={statusLabel(activeRide.status)} />}
        >
          <p aria-live="polite" className="text-sm text-slate-700">
            {statusDetail(activeRide.status)}
          </p>

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Route</dt>
              <dd className="font-medium">
                {activeRide.pickupZone} → {activeRide.destinationZone}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Seats held</dt>
              <dd className="font-medium">{seatsLabel(activeRide.seats)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Fare</dt>
              <dd className="font-medium" data-poisha={activeRide.fare?.totalPoisha ?? 0}>
                {activeRide.fare === null ? '—' : formatBdt(activeRide.fare.totalPoisha)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Requested</dt>
              <dd className="text-slate-700">{formatDateTime(activeRide.createdAt)}</dd>
            </div>
          </dl>

          <div className="mt-4">
            <Link href={`/passenger/rides/${activeRide.id}`}>
              <Button variant="secondary">Open ride</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

/** "Recent rides" — the same rows `/passenger/rides` paginates, trimmed to the latest few. */
function RecentRidesColumn({
  loading,
  rides,
  total,
  hasActive,
}: {
  loading: boolean;
  rides: RideListItem[];
  total: number;
  hasActive: boolean;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-600">Recent rides</h2>

      {loading && (
        <Card>
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Card>
      )}

      {!loading && rides.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600">
            {hasActive
              ? 'That is your only ride so far.'
              : 'Nothing yet — your first request will show up here.'}
          </p>
        </Card>
      )}

      {!loading && rides.length > 0 && (
        <Card>
          <ul className="divide-y divide-slate-100 text-sm">
            {rides.map((ride) => (
              <li key={ride.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <Link
                    className="font-medium text-emerald-700 hover:underline"
                    href={`/passenger/rides/${ride.id}`}
                  >
                    {ride.pickupZone} → {ride.destinationZone}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(ride.createdAt)} · {seatsLabel(ride.seats)}
                  </p>
                </div>
                <StatusChip status={ride.status} label={statusLabel(ride.status)} />
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-slate-500">
            {total} ride{total === 1 ? '' : 's'} total ·{' '}
            <Link className="text-emerald-700" href="/passenger/rides">
              See all
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
