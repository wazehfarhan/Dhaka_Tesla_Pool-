'use client';

/**
 * `/driver/pools/:id` — pool detail and the trip progression (ui-ux §4/§5).
 *
 * Everything on this screen comes from `GET /driver/pools/:id` (api.md §6.2): the
 * roster with each passenger's own status, fare and payment, plus the pool's own
 * timeline. The buttons are **derived from the current status**
 * (`nextDriverAction` in `lib/format.ts`, mirroring the backend's
 * `DRIVER_TRANSITIONS` table) so the driver is never offered a move the API would
 * refuse with `409 ILLEGAL_STATE_TRANSITION` (ui-ux §3).
 *
 * Each action posts to the documented endpoint and renders the *returned* pool —
 * the API re-reads the roster inside the same transaction, so a passenger who
 * cancelled in the meantime is already reflected here (api.md §6.4). Polling
 * stops once the pool is terminal.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PollIndicator } from '@/components/poll-indicator';
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
import { fetchDriverPool, transitionPool, type DriverAction } from '@/lib/api';
import { ApiError, messageForError } from '@/lib/errors';
import {
  canDriverCancel,
  formatBdt,
  formatDateTime,
  isPoolTerminal,
  nextDriverAction,
  poolStatusDetail,
  poolStatusLabel,
  seatsLabel,
  statusLabel,
} from '@/lib/format';
import type { DriverPoolDetail } from '@/lib/types';

export default function DriverPoolPage() {
  const params = useParams<{ id: string }>();
  const poolId = typeof params?.id === 'string' ? params.id : '';

  const [pool, setPool] = useState<DriverPoolDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<DriverAction | null>(null);

  const load = useCallback(async () => {
    if (poolId === '') return;
    try {
      const detail = await fetchDriverPool(poolId);
      setPool(detail);
      setError(null);
      setNotFound(false);
      setReady(true);
    } catch (caught) {
      setReady(true);
      // A foreign or unknown pool is a 404 by design (api.md §1) — not an error to retry.
      if (caught instanceof ApiError && caught.status === 404) {
        setNotFound(true);
        setError(null);
        return;
      }
      setError(messageForError(caught));
      throw caught;
    }
  }, [poolId]);

  const pollingEnabled = !notFound && (pool === null || !isPoolTerminal(pool.status));
  const { failed, refresh } = usePolling(pollingEnabled, load);

  async function act(action: DriverAction) {
    setBusy(action);
    setActionError(null);
    try {
      const updated = await transitionPool(poolId, action);
      // The response carries the pool *after* the transition plus the re-read
      // roster, so the screen is correct immediately (api.md §6.4).
      setPool((current) =>
        current === null
          ? current
          : { ...current, status: updated.status, members: updated.members },
      );
      await load();
    } catch (caught) {
      setActionError(messageForError(caught));
    } finally {
      setBusy(null);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <PageHeading title="Pool not found" description="It may belong to another driver." />
        <Link href="/driver">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const next = pool === null ? null : nextDriverAction(pool.status);
  const loading = !ready && error === null && !notFound;

  return (
    <div className="space-y-4">
      <PageHeading
        title={pool === null ? 'Pool' : `${pool.pickupZone} → ${pool.destinationZone}`}
        description={pool === null ? 'Loading the pool…' : poolStatusDetail(pool.status)}
        actions={<PollIndicator failed={failed} />}
      />

      {error !== null && <ErrorBanner message={error} onRetry={refresh} />}
      {actionError !== null && <ErrorBanner message={actionError} />}

      {loading && (
        <Card>
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Card>
      )}

      {pool !== null && (
        <>
          <Card
            title="Trip"
            tone="accent"
            actions={<StatusChip status={pool.status} label={poolStatusLabel(pool.status)} />}
          >
            <DataList>
              <DataRow label="Seats">
                {pool.seatsTaken}/{pool.seatCapacity}
              </DataRow>
              <DataRow label="Distance">
                {pool.distanceKm === null ? '—' : `${pool.distanceKm} km`}
              </DataRow>
              <DataRow label="Created">{formatDateTime(pool.createdAt)}</DataRow>
              <DataRow label="Pool id">
                <span className="font-mono text-xs">{pool.id}</span>
              </DataRow>
            </DataList>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {next === null ? (
                <p className="text-sm text-ink-500">
                  This trip is finished — nothing left to drive.
                </p>
              ) : (
                <Button pending={busy !== null} onClick={() => act(next.action)}>
                  {next.label}
                </Button>
              )}

              {canDriverCancel(pool.status) && (
                <Button
                  variant="danger"
                  pending={busy !== null}
                  onClick={() => act('cancel')}
                  title="Cancels the pool and every active ride on it"
                >
                  Cancel trip
                </Button>
              )}
            </div>

            {pool.status === 'STARTED' && (
              <Notice tone="warn">The trip has started, so cancelling is no longer offered.</Notice>
            )}
          </Card>

          <Card
            title="Passengers"
            subtitle="Every passenger has their own fare. The pool discount applies once two or more complete the trip."
          >
            <ul className="divide-y divide-ink-900/5 text-sm">
              {pool.members.map((member) => (
                <li key={member.rideId} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">{member.passenger}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-ink-500">{seatsLabel(member.seats)}</span>
                      <StatusChip status={member.status} label={statusLabel(member.status)} />
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                    <span>
                      Fare{' '}
                      {member.fare === null ? (
                        '—'
                      ) : (
                        <span data-poisha={member.fare.totalPoisha}>
                          {formatBdt(member.fare.totalPoisha)}{' '}
                          <span className="text-ink-400">({member.fare.status.toLowerCase()})</span>
                        </span>
                      )}
                    </span>
                    <span>
                      Payment{' '}
                      {member.payment === null
                        ? '—'
                        : `${member.payment.status} · ${formatBdt(member.payment.amountPoisha)}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Timeline"
            subtitle="Every status change the pool went through, as it happened."
          >
            <ol className="relative space-y-0 text-sm">
              {/* Same continuous-rail treatment as the passenger timeline. */}
              <span aria-hidden className="absolute left-[5px] top-2 bottom-4 w-px bg-ink-900/10" />
              {pool.timeline.map((entry, index) => (
                <li
                  key={`${entry.toStatus}-${index}`}
                  className="relative flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pb-4 last:pb-0"
                >
                  <span
                    aria-hidden
                    className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600 ring-4 ring-white"
                  />
                  <span className="text-xs text-ink-500">{formatDateTime(entry.createdAt)}</span>
                  <span className="font-semibold text-ink-900">
                    {entry.fromStatus ?? 'new'} → {entry.toStatus}
                  </span>
                  {entry.reason !== null && (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-600">
                      {entry.reason}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Link
            href="/driver"
            className="inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            Back to dashboard
          </Link>
        </>
      )}
    </div>
  );
}
