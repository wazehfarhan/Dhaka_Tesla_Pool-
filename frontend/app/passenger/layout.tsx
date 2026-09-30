import type { ReactNode } from 'react';
import { RequireRole } from '@/components/require-role';

/**
 * Every `/passenger/*` screen is wrapped in the passenger guard (ui-ux §2). The
 * layout does it once instead of per page, so a new passenger screen cannot
 * forget it.
 */
export default function PassengerLayout({ children }: { children: ReactNode }) {
  return <RequireRole role="PASSENGER">{children}</RequireRole>;
}
