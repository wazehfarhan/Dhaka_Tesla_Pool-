import type { ReactNode } from 'react';
import { RequireRole } from '@/components/require-role';

/**
 * Every `/driver/*` screen is wrapped in the driver guard. The API is still the
 * authority (a passenger calling a driver endpoint gets `403` regardless of what
 * this file does) — see ui-ux §2 and security.md §4.
 */
export default function DriverLayout({ children }: { children: ReactNode }) {
  return <RequireRole role="DRIVER">{children}</RequireRole>;
}
