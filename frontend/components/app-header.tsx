'use client';

/**
 * App chrome: brand, role-aware navigation, current user, sign out (ui-ux §8 —
 * semantic `header`/`nav` landmarks, keyboard reachable, `aria-current` on the
 * active link).
 *
 * The nav is derived from `status`/`user` rather than from the URL: a guest sees
 * Sign in/Register, a passenger sees the three passenger screens, a driver sees
 * the dashboard and their trip history (ui-ux §4). The pool detail screen is
 * reached from the dashboard's queue, not from the nav — it is one step of a
 * trip, not a section.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { BrandMark, Button } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
}

const PASSENGER_NAV: NavItem[] = [
  { href: '/passenger', label: 'Dashboard' },
  { href: '/passenger/request-ride', label: 'Request a ride' },
  { href: '/passenger/rides', label: 'My rides' },
];

const DRIVER_NAV: NavItem[] = [
  { href: '/driver', label: 'Dashboard' },
  { href: '/driver/history', label: 'History' },
];

export function AppHeader() {
  const { status, user, restoring, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const authenticated = status === 'authenticated' && user !== null;

  const nav = authenticated ? (user.role === 'DRIVER' ? DRIVER_NAV : PASSENGER_NAV) : [];

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-30 border-b border-ink-900/5 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-ink-900">
              Dhaka Tesla Pool
            </span>
            <span className="mt-0.5 text-[11px] font-medium text-ink-500">
              Shared rides, one Tesla
            </span>
          </span>
        </Link>

        <nav aria-label="Main" className="flex flex-wrap items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-800'
                    : 'text-ink-600 hover:bg-ink-900/5 hover:text-ink-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {authenticated && user !== null ? (
            <>
              <span
                className="hidden items-center gap-2 rounded-full border border-ink-900/5 bg-ink-50 py-1 pl-1 pr-3 sm:flex"
                data-role={user.role}
              >
                <span
                  aria-hidden
                  className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[11px] font-bold text-white"
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="font-semibold text-ink-800">{user.name}</span>
                <span className="text-xs font-medium text-ink-500">
                  {user.role === 'DRIVER' ? 'Driver' : 'Passenger'}
                </span>
              </span>
              <Button variant="secondary" onClick={handleSignOut} pending={signingOut}>
                Sign out
              </Button>
            </>
          ) : restoring ? (
            <span className="text-xs font-medium text-amber-700">Restoring session…</span>
          ) : (
            status === 'guest' && (
              <>
                <Link
                  className="rounded-lg px-3 py-1.5 font-medium text-ink-600 hover:bg-ink-900/5 hover:text-ink-900"
                  href="/login"
                >
                  Sign in
                </Link>
                <Link href="/register">
                  <Button className="py-2">Get started</Button>
                </Link>
              </>
            )
          )}
        </div>
      </div>
    </header>
  );
}
