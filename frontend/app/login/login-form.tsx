'use client';

/**
 * Login form — ui-ux §2/§5.
 *
 * Behaviour that matters: the button disables and shows `…` while the mutation is
 * in flight (double-click prevention), failures render human copy from the error
 * code, and `?next=` is honoured so a guard redirect resumes where the user was
 * (only same-origin paths are accepted — `safeNextPath`).
 *
 * The demo cast buttons are a deliberate convenience for the recorded demo: the
 * seeded accounts and the `demo1234` password are documented in the README.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { AuthShell } from '@/components/auth-shell';
import { Button, Notice, TextField } from '@/components/ui';
import { messageForError } from '@/lib/errors';
import { DEMO_ACCOUNTS_ENABLED } from '@/lib/env';
import { homePathFor, safeNextPath } from '@/lib/routes';

const DEMO_PASSWORD = 'demo1234';

const DEMO_ACCOUNTS = [
  { label: 'Nusrat (passenger)', email: 'nusrat@example.com' },
  { label: 'Rafiq (passenger)', email: 'rafiq@example.com' },
  { label: 'Jashim (driver)', email: 'jashim@example.com' },
];

export function LoginForm() {
  const { status, user, signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextParam = searchParams.get('next');
  const justCreated = searchParams.get('created') === '1';

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or arrived with a live cookie): go where the session belongs.
  useEffect(() => {
    if (status !== 'authenticated' || user === null) return;
    router.replace(safeNextPath(nextParam, homePathFor(user.role)));
  }, [status, user, nextParam, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const profile = await signIn(email.trim(), password);
      router.replace(safeNextPath(nextParam, homePathFor(profile.role)));
    } catch (caught) {
      setError(messageForError(caught));
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your email and password to pick up where you left off."
    >
      {justCreated && <Notice>Account created — sign in to continue.</Notice>}

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={pending}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.5a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4ZM10 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </p>
        )}

        <Button type="submit" pending={pending} className="w-full py-2.5">
          Sign in
        </Button>
      </form>

      {DEMO_ACCOUNTS_ENABLED && (
        <div className="mt-6 rounded-2xl border border-dashed border-brand-300/60 bg-brand-50/50 p-4">
          <p className="text-sm font-semibold text-brand-900">Demo accounts</p>
          <p className="mt-0.5 text-xs text-brand-800/80">
            One click fills the form — password {DEMO_PASSWORD} for all three.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                type="button"
                variant="secondary"
                disabled={pending}
                className="py-2"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                {account.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-sm text-ink-500">
        No account?{' '}
        <Link className="font-semibold text-brand-700 hover:underline" href="/register">
          Register
        </Link>
        .
      </p>
    </AuthShell>
  );
}
