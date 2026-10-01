'use client';

/**
 * `/passenger/request-ride` (ui-ux §3) — pickup → destination → seats → live fare
 * → request.
 *
 * Three deliberate decisions:
 * 1. **The seat ceiling is the API's** (`poolAvailableSeats` from
 *    `POST /fare/estimate`), so the form cannot offer a seat that is already gone.
 * 2. **`clientRequestId` is stable per intent.** A fresh UUID is minted whenever
 *    the corridor or the seat count changes, so pressing Request again after a
 *    network failure replays the *same* key and returns the original ride (`200`)
 *    instead of double-booking (api.md §5.1).
 * 3. **`POOL_CAPACITY_EXCEEDED` gets its own panel**, not a red line: a race that
 *    loses the last seat deserves the "Bullet is full" state, with a refreshed
 *    seat count (ui-ux §5 "No seats").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FareCard } from '@/components/fare-card';
import { SeatStepper } from '@/components/seat-stepper';
import { ZonePicker } from '@/components/zone-picker';
import { Button, Card, ErrorBanner, Notice, PageHeading, Skeleton } from '@/components/ui';
import { useFareEstimate } from '@/hooks/use-fare-estimate';
import { useZones } from '@/hooks/use-zones';
import { createRide } from '@/lib/api';
import { ApiError, isPoolFull, messageForError, shouldAutoRefresh } from '@/lib/errors';

/** Used only until the first estimate answers with the real capacity (Bullet = 3). */
const ASSUMED_SEAT_CAPACITY = 3;

function newRequestId(): string {
  const browserCrypto = globalThis.crypto as Crypto | undefined;
  if (browserCrypto !== undefined && typeof browserCrypto.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }
  // Non-secure-context fallback: unique per intent, and not a secret.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function RequestRidePage() {
  const router = useRouter();
  const { zones, loading: zonesLoading, error: zonesError, reload: reloadZones } = useZones();

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [seats, setSeats] = useState(1);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [poolFull, setPoolFull] = useState(false);
  const [replayed, setReplayed] = useState(false);

  const {
    estimate,
    loading: estimating,
    error: estimateError,
    reload: reloadEstimate,
  } = useFareEstimate({ pickupZone: pickup, destinationZone: destination, seats });

  const requestIdRef = useRef<string>(newRequestId());
  const intent = `${pickup}|${destination}|${seats}`;

  // New intent (corridor or seat count) → new idempotency key, cleared messages.
  useEffect(() => {
    requestIdRef.current = newRequestId();
    setSubmitError(null);
    setPoolFull(false);
    setReplayed(false);
  }, [intent]);

  // The API is the authority on how many seats are left: never sit above it.
  // Derived during render rather than synced in an effect, so a shrinking pool
  // can never leave a stale, over-capacity seat count on screen for a frame.
  const ceiling =
    estimate === null ? ASSUMED_SEAT_CAPACITY : Math.max(estimate.poolAvailableSeats, 1);
  const requestedSeats = Math.min(Math.max(seats, 1), ceiling);

  const handleEstimateRetry = useCallback(() => reloadEstimate(), [reloadEstimate]);

  const corridorChosen = pickup !== '' && destination !== '' && pickup !== destination;
  const availableSeats = estimate?.poolAvailableSeats ?? 0;
  const seatCapacity = estimate?.seatCapacity ?? ASSUMED_SEAT_CAPACITY;
  const noSeatsLeft = estimate !== null && availableSeats === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setReplayed(false);

    if (!corridorChosen) {
      setSubmitError('Pick a pickup and a destination — they must be different zones.');
      return;
    }
    if (noSeatsLeft) {
      setPoolFull(true);
      return;
    }

    setPending(true);
    try {
      const { ride, replayed: wasReplay } = await createRide({
        pickupZone: pickup,
        destinationZone: destination,
        seats: requestedSeats,
        clientRequestId: requestIdRef.current,
      });
      setReplayed(wasReplay);
      router.push(`/passenger/rides/${ride.id}`);
    } catch (caught) {
      if (isPoolFull(caught)) {
        // Someone claimed the last seat between our estimate and our request.
        setPoolFull(true);
        reloadEstimate();
      } else {
        setSubmitError(messageForError(caught));
        if (caught instanceof ApiError && shouldAutoRefresh(caught.code)) reloadEstimate();
      }
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeading
        title="Request a ride"
        description="Choose your corridor and seats — the fare updates as you go."
        actions={
          <Link href="/passenger">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        }
      />

      {zonesError !== null && <ErrorBanner message={zonesError} onRetry={reloadZones} />}

      <form className="grid gap-6 md:grid-cols-2" onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <Card title="Where and how many">
            {zonesLoading ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <ZonePicker
                  zones={zones}
                  pickup={pickup}
                  destination={destination}
                  onPickupChange={setPickup}
                  onDestinationChange={setDestination}
                  disabled={pending}
                />
                <SeatStepper
                  seats={requestedSeats}
                  maxSeats={ceiling}
                  seatCapacity={seatCapacity}
                  onChange={setSeats}
                  disabled={pending || estimate === null}
                />
              </div>
            )}
          </Card>

          {poolFull && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
            >
              <p className="font-semibold">This route is full</p>
              <p className="mt-1 leading-relaxed">
                Every seat from {pickup} to {destination} is taken. Try another route, or open your
                current ride to see the seat you hold.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPoolFull(false);
                    setPickup('');
                    setDestination('');
                  }}
                >
                  Choose another route
                </Button>
                <Link href="/passenger/rides">
                  <Button type="button" variant="secondary">
                    My rides
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {submitError !== null && <ErrorBanner message={submitError} />}

          {replayed && (
            <Notice>
              This request had already gone through, so we reused it instead of holding a second
              seat.
            </Notice>
          )}

          <Button type="submit" pending={pending} disabled={!corridorChosen || noSeatsLeft}>
            {`Request ${seats === 1 ? '1 seat' : `${seats} seats`}`}
          </Button>
        </div>

        <div className="space-y-3">
          {estimate === null && !estimating && estimateError === null && (
            <Card title="Fare">
              <p className="text-sm leading-relaxed text-ink-500">
                Pick a pickup and a destination to see the fare, the pool discount and the seats
                left on this route.
              </p>
            </Card>
          )}

          {estimating && estimate === null && (
            <Card title="Fare">
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-20 w-full" />
              </div>
            </Card>
          )}

          {estimateError !== null && (
            <ErrorBanner message={estimateError} onRetry={handleEstimateRetry} />
          )}

          {estimate !== null && <FareCard estimate={estimate} seats={requestedSeats} />}

          {estimate !== null && (
            <p
              className="rounded-xl border border-ink-900/5 bg-white px-4 py-2.5 text-center text-xs font-medium text-ink-500"
              data-pool-available-seats={availableSeats}
            >
              <span className="font-bold text-brand-700">{availableSeats}</span> of {seatCapacity}{' '}
              seats left on this route
            </p>
          )}

          <Notice>
            Seats are held the moment they are claimed: if two passengers request the last seat at
            the same time, one gets it and the other is told the route is full.
          </Notice>
        </div>
      </form>
    </div>
  );
}
