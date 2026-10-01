'use client';

/**
 * Session context: who is signed in, and how the app recovers a session.
 *
 * The access token is in memory (`lib/token-store.ts`), so a page reload always
 * starts with none. Rather than bounce the user to `/login` on every refresh,
 * the provider silently calls `POST /auth/refresh` once on mount — the `httpOnly`
 * cookie is the durable half of the session (security.md §1) — then reads
 * `GET /auth/me` for the profile. That is the "silent refresh" of ui-ux §5.
 *
 * If refresh fails at any point the token store clears itself and this provider
 * flips to `guest`, which is what makes the guards redirect mid-session instead
 * of leaving a screen polling a dead token.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import type { RegisterInput } from '@/lib/api';
import { clearRoleCookie, hasSessionHint, setRoleCookie } from '@/lib/cookies';
import { messageForError } from '@/lib/errors';
import { getAccessToken, subscribeToToken } from '@/lib/token-store';
import type { UserProfile } from '@/lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

export interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  /**
   * True when the session could not be restored *yet* because the API throttled
   * us (or was unreachable). Distinct from `guest`: the user is still signed in
   * as far as anyone knows, so the shell shows a retry instead of bouncing them
   * to `/login`.
   */
  restoring: boolean;
  retryRestore: () => void;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  signUp: (input: RegisterInput) => Promise<UserProfile>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** How long to wait before re-asking after a throttle; the window is 60 s. */
const RESTORE_RETRY_MS = 5_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const applyProfile = useCallback((profile: UserProfile) => {
    setUser(profile);
    setRoleCookie(profile.role);
    setRestoring(false);
    setStatus('authenticated');
  }, []);

  const forgetSession = useCallback(() => {
    setUser(null);
    clearRoleCookie();
    setRestoring(false);
    setStatus('guest');
  }, []);

  const retryRestore = useCallback(() => setAttempt((n) => n + 1), []);

  // Restore the session once per page load: refresh (cookie) → me (profile).
  //
  // The `dtp_session` hint (lib/cookies.ts) is checked first: without it there is
  // provably no cookie worth asking about, so a guest gets `guest` immediately
  // instead of a doomed `POST /auth/refresh` on every page view.
  useEffect(() => {
    let cancelled = false;

    if (!hasSessionHint() && getAccessToken() === null) {
      setStatus('guest');
      return;
    }

    void (async () => {
      const outcome = await api.refreshAccessToken();
      if (cancelled) return;
      if (outcome === 'anonymous') {
        setStatus('guest');
        return;
      }
      if (outcome === 'throttled') {
        // Keep the session: the cookie is intact, the API is just busy saying no.
        setRestoring(true);
        setStatus('guest');
        return;
      }
      try {
        const profile = await api.fetchMe();
        if (!cancelled) applyProfile(profile);
      } catch {
        // Refresh was accepted but the profile call was not: treat it as signed out.
        if (!cancelled) forgetSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyProfile, forgetSession, attempt]);

  // A throttled restore is temporary by definition, so try again on a timer.
  useEffect(() => {
    if (!restoring) return;
    const timer = setTimeout(retryRestore, RESTORE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [restoring, retryRestore, attempt]);

  // Any later 401 that refresh cannot fix clears the token; reflect that immediately.
  useEffect(
    () =>
      subscribeToToken((token) => {
        if (token === null)
          setStatus((current) => (current === 'authenticated' ? 'guest' : current));
      }),
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const profile = await api.login(email, password);
      applyProfile(profile);
      return profile;
    },
    [applyProfile],
  );

  const signUp = useCallback(async (input: RegisterInput) => api.register(input), []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      // Signing out must always succeed locally, even if the API call did not.
      console.warn('Logout request failed:', messageForError(error));
    } finally {
      forgetSession();
    }
  }, [forgetSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, restoring, retryRestore, signIn, signUp, signOut }),
    [status, user, restoring, retryRestore, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
