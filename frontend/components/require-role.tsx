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
import { Skeleton, Button, Notice } from '@/components/ui';
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
  const { status, user, restoring, retryRestore } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const wrongRole = status === 'authenticated' && user !== null && user.role !== role;

  useEffect(() => {
    // While a throttled restore is being retried, do NOT send the user to
    // `/login`: they are still signed in, we just could not read the cookie yet.
    if (status === 'guest' && !restoring) {
      router.replace(loginPathFor(pathname));
      return;
    }
    if (wrongRole && user !== null) {
      router.replace(homePathFor(user.role));
    }
  }, [status, restoring, wrongRole, user, router, pathname]);

  if (status === 'loading') return <GuardSkeleton />;
  if (restoring) return <RestoringPanel onRetry={retryRestore} />;
  if (status === 'guest' || user === null || wrongRole) return <GuardSkeleton />;

  return <>{children}</>;
}

/** "Still signed in, the server is just busy" — honest, and it retries itself. */
function RestoringPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <Notice tone="warn">
        Still signed in — the server asked us to slow down. Retrying in a moment.
      </Notice>
      <div className="flex justify-center">
        <Button variant="secondary" onClick={onRetry}>
          Try again now
        </Button>
      </div>
    </div>
  );
}
