'use client';

/**
 * `/register` (guest) — ui-ux §2: name, email, password, role selector.
 *
 * Registering does **not** silently sign the user in: `POST /auth/register`
 * returns the profile without an access token, so the form hands off to `/login`
 * with the email prefilled and an honest "Account created" notice (api.md §2).
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button, Notice, SelectField, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth-shell';
import { messageForError } from '@/lib/errors';
import { homePathFor } from '@/lib/routes';
import type { Role } from '@/lib/types';

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const { status, user, signUp } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('PASSENGER');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An existing session has no business on the register screen.
  useEffect(() => {
    if (status === 'authenticated' && user !== null) router.replace(homePathFor(user.role));
  }, [status, user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setPending(true);
    try {
      const profile = await signUp({ name: name.trim(), email: email.trim(), password, role });
      router.replace(`/login?created=1&email=${encodeURIComponent(profile.email)}`);
    } catch (caught) {
      setError(messageForError(caught));
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create an account"
      subtitle="Passengers request a seat; drivers bring a Tesla online."
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          required
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
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
          autoComplete="new-password"
          required
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
        <SelectField
          label="I am a"
          name="role"
          value={role}
          disabled={pending}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="PASSENGER">Passenger — I want a seat</option>
          <option value="DRIVER">Driver — I have a Tesla</option>
        </SelectField>

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
          Create account
        </Button>
      </form>

      <Notice>
        Drivers register their Teslas from the dashboard and take a car online before passengers can
        request a ride on their corridor.
      </Notice>

      <p className="mt-6 text-sm text-ink-500">
        Already registered?{' '}
        <Link className="font-semibold text-brand-700 hover:underline" href="/login">
          Sign in
        </Link>
        .
      </p>
    </AuthShell>
  );
}
