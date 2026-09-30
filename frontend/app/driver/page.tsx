'use client';

/**
 * `/driver` — an honest placeholder.
 *
 * ui-ux §4 specifies this dashboard around endpoints that **do not exist yet**:
 * the vehicle registry and online toggle (`api.md` §7) and the driver pool queue,
 * detail and transition endpoints (§6) are Phase 5. Rather than inventing data or
 * shipping buttons that 404, this screen states exactly what is missing and what
 * already works — a driver can sign in and is correctly kept out of the
 * passenger screens.
 */

import { Button, Card, Notice, PageHeading } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MISSING_ENDPOINTS: ReadonlyArray<{ method: string; path: string; purpose: string }> = [
  { method: 'GET', path: '/vehicles', purpose: 'the driver’s Teslas' },
  { method: 'PATCH', path: '/vehicles/:id', purpose: 'the online/offline toggle' },
  { method: 'GET', path: '/driver/pools', purpose: 'the OPEN queue and history' },
  { method: 'GET', path: '/driver/pools/:id', purpose: 'roster and per-passenger fares' },
  { method: 'POST', path: '/driver/pools/:id/accept', purpose: 'OPEN → ACCEPTED' },
  { method: 'POST', path: '/driver/pools/:id/arrive', purpose: 'ACCEPTED → DRIVER_ARRIVED' },
  { method: 'POST', path: '/driver/pools/:id/start', purpose: 'DRIVER_ARRIVED → STARTED' },
  {
    method: 'POST',
    path: '/driver/pools/:id/complete',
    purpose: 'STARTED → COMPLETED (final fare)',
  },
];

export default function DriverDashboardPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();
    router.push('/login');
  }

  return (
    <div className="space-y-4">
      <PageHeading
        title={`Hello, ${user?.name ?? 'driver'}`}
        description="Driver screens arrive with Phase 5 — the API they need is not built yet."
        actions={
          <Button variant="secondary" pending={pending} onClick={handleSignOut}>
            Sign out
          </Button>
        }
      />

      <Notice tone="warn">
        Nothing on this screen is mocked: a driver login, a role-guarded route and a real
        <code className="mx-1">403</code> from the API are all working today.
      </Notice>

      <Card
        title="What is missing"
        subtitle="Each row is a documented endpoint (api.md §6–§7) with no implementation yet."
      >
        <ul className="divide-y divide-slate-100 text-sm">
          {MISSING_ENDPOINTS.map((endpoint) => (
            <li key={`${endpoint.method} ${endpoint.path}`} className="flex flex-wrap gap-2 py-2">
              <span className="font-mono text-xs text-slate-500">{endpoint.method}</span>
              <span className="font-mono text-xs text-slate-800">{endpoint.path}</span>
              <span className="text-slate-600">— {endpoint.purpose}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Meanwhile">
        <p className="text-sm text-slate-700">
          The passenger flow is complete end to end: a passenger can sign in, see a live fare for a
          corridor, request a ride, and follow the status timeline while polling every 3 s.
        </p>
      </Card>
    </div>
  );
}
