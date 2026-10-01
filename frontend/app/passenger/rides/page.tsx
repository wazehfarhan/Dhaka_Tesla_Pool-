'use client';

/**
 * `/passenger/rides` — history (ui-ux §2, FR-HISTORY-001): paginated, filterable
 * by status, with the fare and payment status on every row.
 *
 * The list endpoint serves both this screen and the dashboard, so the only logic
 * here is paging + filtering; the rows themselves are the API's rows, printed.
 * Filtering resets to page 1 — a filter change that left you on page 4 would be a
 * lie about how many rows matched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PollIndicator } from '@/components/poll-indicator';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeading,
  RouteLine,
  SelectField,
  Skeleton,
  StatusChip,
} from '@/components/ui';
import { usePolling } from '@/hooks/use-polling';
import { fetchRides } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import { formatBdt, formatDateTime, seatsLabel, statusLabel } from '@/lib/format';
import type { RideListItem } from '@/lib/types';

const PAGE_SIZE = 10;

/** The six ride states, in lifecycle order — `''` means "no filter". */
const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'ACCEPTED', label: 'Driver accepted' },
  { value: 'DRIVER_ARRIVED', label: 'Driver arrived' },
  { value: 'STARTED', label: 'Trip started' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

interface HistoryState {
  rides: RideListItem[];
  total: number;
  ready: boolean;
  error: string | null;
}

export default function RideHistoryPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<HistoryState>({
    rides: [],
    total: 0,
    ready: false,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const result = await fetchRides({ status, page, limit: PAGE_SIZE });
      setState({ rides: result.rides, total: result.meta.total, ready: true, error: null });
    } catch (caught) {
      setState((current) => ({ ...current, error: messageForError(caught) }));
      throw caught;
    }
  }, [status, page]);

  const { failed, refresh } = usePolling(true, load);

  // Filter/paging changes must fetch immediately, not wait for the next 3 s tick.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setState((current) => ({ ...current, ready: false }));
    refresh();
  }, [status, page, refresh]);

  const pageCount = Math.max(Math.ceil(state.total / PAGE_SIZE), 1);
  const loading = !state.ready;

  return (
    <div className="space-y-4">
      <PageHeading
        title="My rides"
        description="Every request, its status, and what it cost."
        actions={<PollIndicator failed={failed} />}
      />

      <div className="surface px-4 py-3.5 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="w-full sm:max-w-xs">
          <SelectField
            label="Filter by status"
            name="status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="mt-3 text-sm text-ink-500 sm:mt-0">
          {state.total} ride{state.total === 1 ? '' : 's'}
          {status === '' ? '' : ' matching that filter'}
        </p>
      </div>

      {state.error !== null && <ErrorBanner message={state.error} onRetry={refresh} />}

      {loading && (
        <Card>
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        </Card>
      )}

      {!loading && state.rides.length === 0 && (
        <EmptyState
          title={status === '' ? 'No rides yet' : 'Nothing with that status'}
          description={
            status === ''
              ? 'Request a ride and it will appear here with its fare and payment status.'
              : 'Try another filter, or clear it to see everything.'
          }
          action={
            <Link href="/passenger/request-ride">
              <Button>Request a ride</Button>
            </Link>
          }
        />
      )}

      {!loading && state.rides.length > 0 && (
        <Card>
          <ul className="divide-y divide-ink-900/5">
            {state.rides.map((ride) => (
              <RideRow key={ride.id} ride={ride} />
            ))}
          </ul>

          <nav
            aria-label="Pagination"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-900/5 pt-4 text-sm"
          >
            <Button
              variant="secondary"
              className="py-2"
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-ink-500" data-page={page} data-total={state.total}>
              Page {page} of {pageCount}
            </span>
            <Button
              variant="secondary"
              className="py-2"
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount}
            >
              Next
            </Button>
          </nav>
        </Card>
      )}
    </div>
  );
}

/** One history row: corridor, seats, status, fare, payment — all straight from `GET /rides`. */
function RideRow({ ride }: { ride: RideListItem }) {
  const paymentLabel =
    ride.payment === null ? 'Payment pending' : ride.payment.status === 'PAID' ? 'Paid' : 'Unpaid';

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Link
          className="font-semibold text-ink-900 hover:text-brand-700"
          href={`/passenger/rides/${ride.id}`}
        >
          <RouteLine from={ride.pickupZone} to={ride.destinationZone} />
        </Link>
        <p className="mt-0.5 text-xs text-ink-500">
          {formatDateTime(ride.createdAt)} · {seatsLabel(ride.seats)}
          {ride.distanceKm === null ? '' : ` · ${ride.distanceKm} km`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className="text-sm font-bold tracking-tight text-ink-900"
          data-poisha={ride.fare?.totalPoisha ?? 0}
        >
          {ride.fare === null ? '—' : formatBdt(ride.fare.totalPoisha)}
        </span>
        <StatusChip status={ride.status} label={statusLabel(ride.status)} />
        <StatusChip status={ride.payment?.status ?? 'NO_PAYMENT'} label={paymentLabel} />
      </div>
    </li>
  );
}
