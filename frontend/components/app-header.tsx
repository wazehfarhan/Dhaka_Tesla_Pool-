'use client';

/**
 * App chrome: brand, role-aware navigation, current user, sign out (ui-ux §8 —
 * semantic `header`/`nav` landmarks, keyboard reachable, `aria-current` on the
 * active link).
 *
 * The nav is derived from `status`/`user` rather than from the URL: a guest sees
 * Sign in/Register, a passenger sees the three passenger screens, a driver sees
 * the driver dashboard (the rest of the driver nav arrives with Phase 5).
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
}

const PASSENGER_NAV: NavItem[] = [
  { href: '/passenger', label: 'Dashboard' },
  { href: '/passenger/request-ride', label: 'Request a ride' },
  { href: '/passenger/rides', label: 'My rides' },
];

const DRIVER_NAV: NavItem[] = [{ href: '/driver', label: 'Dashboard' }];

export function AppHeader() {
  const { status, user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const nav =
    status === 'authenticated' && user !== null
      ? user.role === 'DRIVER'
        ? DRIVER_NAV
        : PASSENGER_NAV
      : [];

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.push('/login');
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold text-slate-900">
          Dhaka Tesla Pool
        </Link>

        <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active ? 'font-medium text-emerald-700' : 'text-slate-600 hover:text-slate-900'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {status === 'authenticated' && user !== null ? (
            <>
              <span className="text-slate-600" data-role={user.role}>
                {user.name}
              </span>
              <Button variant="secondary" onClick={handleSignOut} pending={signingOut}>
                Sign out
              </Button>
            </>
          ) : (
            status === 'guest' && (
              <>
                <Link className="text-slate-600 hover:text-slate-900" href="/login">
                  Sign in
                </Link>
                <Link className="text-slate-600 hover:text-slate-900" href="/register">
                  Register
                </Link>
              </>
            )
          )}
        </div>
      </div>
    </header>
  );
}
