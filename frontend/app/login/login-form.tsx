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
import { Button, Card, Notice, PageHeading, TextField } from '@/components/ui';
import { messageForError } from '@/lib/errors';
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
    <div className="mx-auto max-w-sm space-y-4">
      <PageHeading title="Sign in" description="Use your email and password." />

      {justCreated && <Notice>Account created — sign in to continue.</Notice>}

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
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
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          <Button type="submit" pending={pending} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>

      <Card title="Demo accounts" subtitle={`Seeded password for all: ${DEMO_PASSWORD}`}>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <Button
              key={account.email}
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {account.label}
            </Button>
          ))}
        </div>
      </Card>

      <p className="text-sm text-slate-600">
        No account?{' '}
        <Link className="font-medium text-emerald-700" href="/register">
          Register
        </Link>
        .
      </p>
    </div>
  );
}
