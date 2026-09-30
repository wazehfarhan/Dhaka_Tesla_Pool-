'use client';

/**
 * Client-side route guard — ui-ux §2 and §5 ("wrong role on a route → redirect to
 * own dashboard"; "refresh fails → redirect to `/login` preserving `?next=`").
 *
 * This runs *in addition to* `middleware.ts`, which cannot see the in-memory
 * token and therefore only knows the role cookie. Neither is security: every
 * request the screens make is authorised again by the API (security.md §4).
 */

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { homePathFor, loginPathFor } from '@/lib/routes';
import type { Role } from '@/lib/types';

/** Loading state for a guarded screen — skeletons, never a spinner-only page (ui-ux §5). */
function GuardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const wrongRole = status === 'authenticated' && user !== null && user.role !== role;

  useEffect(() => {
    if (status === 'guest') {
      router.replace(loginPathFor(pathname));
      return;
    }
    if (wrongRole && user !== null) {
      router.replace(homePathFor(user.role));
    }
  }, [status, wrongRole, user, router, pathname]);

  if (status === 'loading') return <GuardSkeleton />;
  if (status === 'guest' || user === null || wrongRole) return <GuardSkeleton />;

  return <>{children}</>;
}
