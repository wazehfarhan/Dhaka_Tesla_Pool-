'use client';

/**
 * `/` — a pure redirect (ui-ux §2): passenger → `/passenger`, driver → `/driver`,
 * guest → `/login`.
 *
 * The decision needs the session, which only exists in the browser (in-memory
 * token + `httpOnly` cookie), so this is a client redirect with a skeleton while
 * `AuthProvider` restores. There is deliberately no flash of a landing page.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Skeleton } from '@/components/ui';
import { homePathFor } from '@/lib/routes';

export default function HomePage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    router.replace(status === 'authenticated' && user !== null ? homePathFor(user.role) : '/login');
  }, [status, user, router]);

  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
