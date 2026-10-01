'use client';

/**
 * `/driver` — the driver dashboard (ui-ux §4): garage with the **online toggle**,
 * the **active trip**, and the **Requests queue**, all from one page of
 * `GET /driver/pools` (api.md §6.1) plus `GET /vehicles` (§7.1).
 *
 * Polling: the queue and the active trip refresh every 3 s (ui-ux §7) so a
 * passenger's request appears without a refresh, and the poll stops once nothing
 * is left to watch (no live pool). Every sentence is derived from a status the
 * API returned — nothing here is mocked.
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
  Notice,
  PageHeading,
  RouteLine,
  Skeleton,
  Stat,
  StatusChip,
  TextField,
} from '@/components/ui';
import { usePolling } from '@/hooks/use-polling';
import { createVehicle, fetchDriverPools, fetchVehicles, setVehicleStatus } from '@/lib/api';
import { messageForError } from '@/lib/errors';
import {
  formatDateTime,
  isPoolTerminal,
  nextDriverAction,
  poolStatusDetail,
  poolStatusLabel,
  seatsLabel,
} from '@/lib/format';
import type { DriverPoolListItem, VehicleSummary } from '@/lib/types';

interface DashboardState {
  vehicles: VehicleSummary[];
  pools: DriverPoolListItem[];
  ready: boolean;
  error: string | null;
}

export default function DriverDashboardPage() {
  const { user } = useAuth();
  const [state, setState] = useState<DashboardState>({
    vehicles: [],
    pools: [],
    ready: false,
    error: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyVehicle, setBusyVehicle] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ model: '', plate: '', seatCapacity: '3' });

  const load = useCallback(async () => {
    try {
      // Two independent reads, in parallel — both are cheap and owner-scoped.
      const [vehicles, pools] = await Promise.all([
        fetchVehicles(),
        fetchDriverPools({ limit: 20 }),
      ]);
      setState({ vehicles, pools: pools.pools, ready: true, error: null });
    } catch (caught) {
      setState((current) => ({ ...current, error: messageForError(caught) }));
      throw caught;
    }
  }, []);

  // The dashboard always polls: a passenger's request can land at any moment, and
  // that is exactly the "Requests queue" the demo watches (ui-ux §7).
  const { failed, refresh } = usePolling(true, load);

  const activeTrip =
    state.pools.find((pool) => pool.status !== 'OPEN' && !isPoolTerminal(pool.status)) ?? null;
  const queue = state.pools.filter((pool) => pool.status === 'OPEN');
  const loading = !state.ready && state.error === null;
  const onlineVehicle = state.vehicles.find((vehicle) => vehicle.status === 'ONLINE') ?? null;

  async function toggleVehicle(vehicle: VehicleSummary) {
    setBusyVehicle(vehicle.id);
    setActionError(null);
    try {
      await setVehicleStatus(vehicle.id, vehicle.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE');
      await load();
    } catch (caught) {
      setActionError(messageForError(caught));
    } finally {
      setBusyVehicle(null);
    }
  }

  async function addVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setActionError(null);
    try {
      await createVehicle({
        model: form.model.trim(),
        plate: form.plate.trim(),
        seatCapacity: Number(form.seatCapacity),
      });
      setForm({ model: '', plate: '', seatCapacity: '3' });
      await load();
    } catch (caught) {
      setActionError(messageForError(caught));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Driver"
        title={`Hello, ${user?.name ?? 'driver'}`}
        description="Your Teslas, the requests waiting for you, and the trip you are running."
        actions={<PollIndicator failed={failed} />}
      />

      {state.error !== null && <ErrorBanner message={state.error} onRetry={refresh} />}
      {actionError !== null && <ErrorBanner message={actionError} />}

      {onlineVehicle === null && state.ready && (
        <Notice tone="warn">
          No Tesla is <strong>online</strong>, so passengers cannot request a ride on your routes.
          Go online below to open your corridors.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Teslas online"
          value={`${state.vehicles.filter((vehicle) => vehicle.status === 'ONLINE').length}/${state.vehicles.length}`}
          hint={onlineVehicle === null ? 'No corridor is open' : 'Accepting requests'}
          tone={onlineVehicle === null ? 'amber' : 'brand'}
        />
        <Stat
          label="Open requests"
          value={queue.length}
          hint="Seats already held for you"
          tone={queue.length > 0 ? 'amber' : 'plain'}
        />
        <Stat
          label="Current trip"
          value={activeTrip === null ? 'None' : poolStatusLabel(activeTrip.status)}
          hint={
            activeTrip === null
              ? 'Nothing running'
              : `${activeTrip.seatsTaken}/${activeTrip.seatCapacity} seats on board`
          }
          tone={activeTrip === null ? 'plain' : 'brand'}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <GarageCard
          loading={loading}
          vehicles={state.vehicles}
          busyVehicle={busyVehicle}
          onToggle={toggleVehicle}
          adding={adding}
          form={form}
          onFormChange={setForm}
          onSubmit={addVehicle}
        />

        <div className="space-y-6">
          <ActiveTripCard loading={loading} trip={activeTrip} />
          <RequestsCard loading={loading} queue={queue} />
        </div>
      </div>
    </div>
  );
}

/** The garage (api.md §7): every Tesla with its online toggle, plus the add form. */
function GarageCard({
  loading,
  vehicles,
  busyVehicle,
  onToggle,
  adding,
  form,
  onFormChange,
  onSubmit,
}: {
  loading: boolean;
  vehicles: VehicleSummary[];
  busyVehicle: string | null;
  onToggle: (vehicle: VehicleSummary) => void;
  adding: boolean;
  form: { model: string; plate: string; seatCapacity: string };
  onFormChange: (form: { model: string; plate: string; seatCapacity: string }) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card title="My Teslas" subtitle="Take a car online to open your corridors to requests.">
      {loading && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {!loading && vehicles.length === 0 && (
        <EmptyState
          title="No Tesla yet"
          description="Add your car below — it starts offline so you decide when to take requests."
        />
      )}

      {!loading && vehicles.length > 0 && (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {vehicles.map((vehicle) => (
            <li
              key={vehicle.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
            >
              <div>
                <p className="font-semibold text-ink-900">
                  {vehicle.model}{' '}
                  <span className="font-mono text-xs font-normal text-ink-500">
                    {vehicle.plate}
                  </span>
                </p>
                <p className="text-xs text-ink-500">{seatsLabel(vehicle.seatCapacity)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip
                  status={vehicle.status}
                  label={vehicle.status === 'ONLINE' ? 'Online' : 'Offline'}
                />
                <Button
                  variant={vehicle.status === 'ONLINE' ? 'secondary' : 'primary'}
                  pending={busyVehicle === vehicle.id}
                  className="py-2"
                  onClick={() => onToggle(vehicle)}
                >
                  {vehicle.status === 'ONLINE' ? 'Go offline' : 'Go online'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="mt-5 space-y-3 border-t border-ink-900/5 pt-5" onSubmit={onSubmit}>
        <p className="text-sm font-semibold text-ink-800">Add a Tesla</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Model"
            name="model"
            value={form.model}
            placeholder="Tesla Model 3"
            onChange={(event) => onFormChange({ ...form, model: event.target.value })}
            required
          />
          <TextField
            label="Plate"
            name="plate"
            value={form.plate}
            placeholder="DHK-TSL-001"
            onChange={(event) => onFormChange({ ...form, plate: event.target.value })}
            required
          />
          <TextField
            label="Seats"
            name="seatCapacity"
            type="number"
            min={1}
            max={8}
            value={form.seatCapacity}
            onChange={(event) => onFormChange({ ...form, seatCapacity: event.target.value })}
            required
          />
        </div>
        <Button type="submit" pending={adding}>
          Add vehicle
        </Button>
      </form>
    </Card>
  );
}

/** The trip the driver is actually running: the latest non-`OPEN` live pool. */
function ActiveTripCard({ loading, trip }: { loading: boolean; trip: DriverPoolListItem | null }) {
  if (loading) {
    return (
      <Card title="Current trip">
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
    );
  }

  if (trip === null) {
    return (
      <Card title="Current trip">
        <EmptyState
          title="No trip running"
          description="Accept a request from the queue below and the trip will show up here with its next action."
        />
      </Card>
    );
  }

  const next = nextDriverAction(trip.status);
  return (
    <Card
      title="Current trip"
      subtitle={poolStatusDetail(trip.status)}
      tone="accent"
      actions={<StatusChip status={trip.status} label={poolStatusLabel(trip.status)} />}
    >
      <p className="text-lg font-bold tracking-tight text-ink-900">
        <RouteLine from={trip.pickupZone} to={trip.destinationZone} />
      </p>
      <div className="mt-4">
        <DataList>
          <DataRow label="Seats on board">
            {trip.seatsTaken}/{trip.seatCapacity}
          </DataRow>
          <DataRow label="Passengers">
            {trip.members.map((member) => member.passenger).join(', ') || '—'}
          </DataRow>
          <DataRow label="Requested">{formatDateTime(trip.createdAt)}</DataRow>
        </DataList>
      </div>
      <div className="mt-4">
        <Link href={`/driver/pools/${trip.id}`}>
          <Button className="w-full">{next === null ? 'Open pool' : next.label}</Button>
        </Link>
      </div>
    </Card>
  );
}

/** The Requests queue — the `OPEN` pools, refreshed every 3 s (api.md §6.1). */
function RequestsCard({ loading, queue }: { loading: boolean; queue: DriverPoolListItem[] }) {
  return (
    <Card
      title="Requests"
      subtitle="Seats are already held while a pool waits for you."
      actions={
        <Link className="text-sm text-brand-700" href="/driver/history">
          History
        </Link>
      }
    >
      {loading && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-full" />
        </div>
      )}

      {!loading && queue.length === 0 && (
        <EmptyState
          title="No open requests"
          description="When a passenger requests one of your corridors, it appears here with the seats already reserved."
        />
      )}

      {!loading && queue.length > 0 && (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {queue.map((pool) => (
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
                  {formatDateTime(pool.createdAt)} · {pool.seatsTaken}/{pool.seatCapacity} seats ·{' '}
                  {pool.members.map((member) => member.passenger).join(', ')}
                </p>
              </div>
              <StatusChip status={pool.status} label={poolStatusLabel(pool.status)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
