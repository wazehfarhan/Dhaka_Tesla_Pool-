import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ROLE_COOKIE } from '@/lib/cookies';
import { roleForPath } from '@/lib/routes';

/**
 * Role routing at the edge (ui-ux §2: "Middleware (Next.js) enforces role
 * access").
 *
 * It can only read cookies, so it reads the one readable cookie the app sets
 * (`dtp_role`) — never the access token, which lives in memory, or the refresh
 * token, which is `httpOnly`. Consequences, stated plainly: this is a redirect
 * convenience for humans, the API is the security boundary, and a tampered cookie
 * can only move a user between two screens that both still require a real token.
 *
 * A guest (no cookie) is sent to `/login?next=…`; the client guard in
 * `components/require-role.tsx` repeats the check once the session is restored,
 * because middleware cannot know whether the refresh cookie is still valid.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const requiredRole = roleForPath(pathname);
  if (requiredRole === null) return NextResponse.next();

  const cookieRole = request.cookies.get(ROLE_COOKIE)?.value;

  if (cookieRole === undefined) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  if (cookieRole !== requiredRole) {
    const ownDashboard = request.nextUrl.clone();
    ownDashboard.pathname = cookieRole === 'DRIVER' ? '/driver' : '/passenger';
    ownDashboard.search = '';
    return NextResponse.redirect(ownDashboard);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/passenger/:path*', '/driver/:path*'],
};
