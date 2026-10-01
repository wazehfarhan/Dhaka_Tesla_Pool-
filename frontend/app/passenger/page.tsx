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
  DataList,
  DataRow,
  EmptyState,
  ErrorBanner,
  PageHeading,
  RouteLine,
  Skeleton,
  Stat,
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
        eyebrow="Passenger"
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active ride"
          value={activeRide === null ? 'None' : statusLabel(activeRide.status)}
          tone={activeRide === null ? 'plain' : 'brand'}
        />
        <Stat
          label="Seats held"
          value={activeRide === null ? '—' : seatsLabel(activeRide.seats)}
          hint={activeRide === null ? 'Request a ride to hold seats' : 'Released if you cancel'}
        />
        <Stat label="Rides so far" value={state.total} hint="Completed and cancelled" />
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <CurrentRideColumn loading={loading} activeRide={activeRide} />
        <RecentRidesColumn loading={loading} rides={recentRides} hasActive={activeRide !== null} />
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
          tone="accent"
          actions={<StatusChip status={activeRide.status} label={statusLabel(activeRide.status)} />}
        >
          <p aria-live="polite" className="text-sm leading-relaxed text-ink-600">
            {statusDetail(activeRide.status)}
          </p>

          <p className="mt-3 text-xl font-bold tracking-tight text-ink-900">
            <RouteLine from={activeRide.pickupZone} to={activeRide.destinationZone} />
          </p>

          <div className="mt-4">
            <DataList>
              <DataRow label="Seats held">{seatsLabel(activeRide.seats)}</DataRow>
              <DataRow label="Fare">
                <span data-poisha={activeRide.fare?.totalPoisha ?? 0}>
                  {activeRide.fare === null ? '—' : formatBdt(activeRide.fare.totalPoisha)}
                </span>
              </DataRow>
              <DataRow label="Requested">{formatDateTime(activeRide.createdAt)}</DataRow>
            </DataList>
          </div>

          <div className="mt-4">
            <Link href={`/passenger/rides/${activeRide.id}`}>
              <Button className="w-full">Open ride</Button>
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
  hasActive,
}: {
  loading: boolean;
  rides: RideListItem[];
  hasActive: boolean;
}) {
  return (
    <div className="space-y-3">
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
        <Card title="Recent rides">
          <p className="text-sm leading-relaxed text-ink-500">
            {hasActive
              ? 'That is your only ride so far. Finished trips and their fares will collect here.'
              : 'Nothing yet — your first request will show up here with its status and fare.'}
          </p>
        </Card>
      )}

      {!loading && rides.length > 0 && (
        <Card
          title="Recent rides"
          actions={
            <Link
              className="text-sm font-semibold text-brand-700 hover:underline"
              href="/passenger/rides"
            >
              See all
            </Link>
          }
        >
          <ul className="divide-y divide-ink-900/5 text-sm">
            {rides.map((ride) => (
              <li
                key={ride.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <Link
                    className="font-semibold text-ink-900 hover:text-brand-700"
                    href={`/passenger/rides/${ride.id}`}
                  >
                    <RouteLine from={ride.pickupZone} to={ride.destinationZone} />
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatDateTime(ride.createdAt)} · {seatsLabel(ride.seats)}
                  </p>
                </div>
                <StatusChip status={ride.status} label={statusLabel(ride.status)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
