'use client';

/**
 * `/passenger/rides/:id` — ride detail (ui-ux §2/§3): status timeline, pool
 * summary, fare breakdown, payment, and the actions that belong to the current
 * state.
 *
 * Polling: every 3 s while the ride is live, and **stopped** once it is
 * COMPLETED or CANCELLED (ui-ux §7 — a finished ride has nothing left to learn).
 * The status sentence sits in an `aria-live="polite"` region so "Driver arrived"
 * is announced when it changes (ui-ux §8).
 *
 * Cancel and Pay are real mutations now (api.md §5.4 and §8): each posts to the
 * documented endpoint and then re-reads the ride, so the screen shows the
 * server's answer. Both are offered only where the API allows them — Pay once
 * the pool completed, Cancel until the driver starts the trip (ui-ux §3).
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FareBreakdown } from '@/components/fare-card';
import { PollIndicator } from '@/components/poll-indicator';
import { StatusTimeline } from '@/components/status-timeline';
import {
  Button,
  Card,
  DataList,
  DataRow,
  ErrorBanner,
  Notice,
  PageHeading,
  Skeleton,
  StatusChip,
} from '@/components/ui';
import { usePolling } from '@/hooks/use-polling';
import { cancelRide, fetchRideDetail, simulatePayment } from '@/lib/api';
import { ApiError, messageForError } from '@/lib/errors';
import {
  formatBdt,
  formatDateTime,
  isTerminal,
  seatsLabel,
  statusDetail,
  statusLabel,
} from '@/lib/format';
import type { RideDetail } from '@/lib/types';

/** ui-ux §3: cancel is offered while the ride is REQUESTED, ACCEPTED or DRIVER_ARRIVED. */
const CANCELLABLE = new Set(['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED']);

export default function RideDetailPage() {
  const params = useParams<{ id: string }>();
  const rideId = typeof params?.id === 'string' ? params.id : '';

  const [ride, setRide] = useState<RideDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'pay' | null>(null);

  const load = useCallback(async () => {
    if (rideId === '') return;
    try {
      const detail = await fetchRideDetail(rideId);
      setRide(detail);
      setError(null);
      setNotFound(false);
      setReady(true);
    } catch (caught) {
      setReady(true);
      // A foreign or unknown id is a 404 by design (api.md §1) — not an error to retry.
      if (caught instanceof ApiError && caught.status === 404) {
        setNotFound(true);
        setError(null);
        return;
      }
      setError(messageForError(caught));
      throw caught;
    }
  }, [rideId]);

  const pollingEnabled = !notFound && (ride === null || !isTerminal(ride.status));
  const { failed, refresh } = usePolling(pollingEnabled, load);

  /**
   * Cancel and Pay (api.md §5.4 / §8) both re-read the ride afterwards rather
   * than patching local state: the API's response is the truth, and a refusal
   * (`409 RIDE_ALREADY_STARTED`, `409 ILLEGAL_STATE_TRANSITION`) is shown as
   * human copy from `errors.ts` while the screen stays correct.
   */
  async function handleCancel() {
    setBusy('cancel');
    setActionError(null);
    try {
      await cancelRide(rideId);
      await load();
    } catch (caught) {
      setActionError(messageForError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handlePay() {
    setBusy('pay');
    setActionError(null);
    try {
      await simulatePayment(rideId);
      await load();
    } catch (caught) {
      setActionError(messageForError(caught));
    } finally {
      setBusy(null);
    }
  }

  const loading = !ready && error === null && !notFound;

  if (notFound) {
    return (
      <div className="space-y-4">
        <PageHeading
          title="Ride not found"
          description="It may have been removed, or it is not yours."
        />
        <Link href="/passenger">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeading
        title={ride === null ? 'Ride' : `${ride.pickupZone} → ${ride.destinationZone}`}
        description={ride === null ? undefined : `Requested ${formatDateTime(ride.createdAt)}`}
        actions={
          <div className="flex items-center gap-3">
            {ride !== null && <PollIndicator failed={failed} />}
            <Link href="/passenger">
              <Button variant="secondary">Dashboard</Button>
            </Link>
          </div>
        }
      />

      {error !== null && <ErrorBanner message={error} onRetry={refresh} />}
      {actionError !== null && <ErrorBanner message={actionError} />}

      {loading && (
        <Card>
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-28 w-full" />
          </div>
        </Card>
      )}

      {ride !== null && (
        <RideDetailBody ride={ride} busy={busy} onCancel={handleCancel} onPay={handlePay} />
      )}
    </div>
  );
}

/** Everything below the heading, once the ride has loaded. */
function RideDetailBody({
  ride,
  busy,
  onCancel,
  onPay,
}: {
  ride: RideDetail;
  busy: 'cancel' | 'pay' | null;
  onCancel: () => void;
  onPay: () => void;
}) {
  const cancellable = CANCELLABLE.has(ride.status);
  const completed = ride.status === 'COMPLETED';
  const paid = ride.payment?.status === 'PAID';
  /** A payment row only exists after completion, so this is the whole story. */
  const payable = completed && ride.payment !== null && !paid;

  return (
    <>
      <Card
        title={statusLabel(ride.status)}
        actions={<StatusChip status={ride.status} label={statusLabel(ride.status)} />}
      >
        <p aria-live="polite" className="text-sm text-slate-700">
          {statusDetail(ride.status)}
        </p>

        <div className="mt-3">
          <DataList>
            <DataRow label="Seats held">{seatsLabel(ride.seats)}</DataRow>
            <DataRow label="Distance">
              {ride.distanceKm === null ? '—' : `${ride.distanceKm} km`}
            </DataRow>
            <DataRow label="Pool">
              <span data-pool-status={ride.pool.status}>
                {ride.pool.seatsTaken}/{ride.pool.seatCapacity} seats · {ride.pool.memberCount}{' '}
                passenger{ride.pool.memberCount === 1 ? '' : 's'}
              </span>
            </DataRow>
            <DataRow label="Ride id">
              <span className="font-mono text-xs text-slate-600">{ride.id}</span>
            </DataRow>
          </DataList>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Status">
          <StatusTimeline status={ride.status} timeline={ride.timeline} />
        </Card>

        <div className="space-y-4">
          <Card title="Fare">
            {ride.fare === null ? (
              <p className="text-sm text-slate-600">The fare has not been recorded yet.</p>
            ) : (
              <FareBreakdown fare={ride.fare} distanceKm={ride.distanceKm} />
            )}
          </Card>

          <Card title="Payment">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-700">
                {ride.payment === null
                  ? 'No payment yet — one is created when the trip completes.'
                  : ride.payment.status === 'PAID'
                    ? 'Paid (simulated).'
                    : 'Unpaid — pay when the trip has completed.'}
              </p>
              <span data-poisha={ride.payment?.amountPoisha ?? 0}>
                {formatBdt(ride.payment?.amountPoisha ?? ride.fare?.totalPoisha ?? 0)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusChip
                status={ride.payment?.status ?? 'NO_PAYMENT'}
                label={
                  ride.payment === null
                    ? 'No payment'
                    : ride.payment.status === 'PAID'
                      ? 'Paid'
                      : 'Unpaid'
                }
              />
              <Button
                type="button"
                pending={busy === 'pay'}
                disabled={!payable}
                onClick={onPay}
                title={
                  payable
                    ? 'Marks the payment PAID — simulated, no real gateway (api.md §8)'
                    : 'Payment opens once the trip has completed'
                }
              >
                {paid ? 'Paid' : 'Pay (simulated)'}
              </Button>
            </div>

            {!completed && (
              <p className="mt-3 text-xs text-slate-500">
                Payment opens once the pool completes — a final fare only exists then.
              </p>
            )}
          </Card>

          {cancellable && (
            <Card
              title="Cancel"
              subtitle="Freeing your seat immediately — the driver is notified by the status change (PRD §14)."
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="danger"
                  pending={busy === 'cancel'}
                  onClick={onCancel}
                >
                  Cancel ride
                </Button>
                <span className="text-xs text-slate-500">
                  Only possible before the driver starts the trip.
                </span>
              </div>
            </Card>
          )}

          {ride.status === 'STARTED' && (
            <Notice tone="warn">
              The trip has started, so cancellation is no longer offered (ui-ux §3).
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}
