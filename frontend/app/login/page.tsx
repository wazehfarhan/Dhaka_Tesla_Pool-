import { Suspense } from 'react';
import { Skeleton } from '@/components/ui';
import { LoginForm } from './login-form';

/**
 * `/login` (guest) — ui-ux §2. The form is a client component because it reads
 * `?next=`, which Next requires to sit behind a `Suspense` boundary.
 *
 * The route intentionally exists as a real 200 (not a redirect) so the Compose
 * healthcheck in Phase 12 can target it.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-sm space-y-3" aria-busy="true">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
