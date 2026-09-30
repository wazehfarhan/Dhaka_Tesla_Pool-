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
import { Button, Card, Notice, PageHeading, SelectField, TextField } from '@/components/ui';
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
    <div className="mx-auto max-w-sm space-y-4">
      <PageHeading
        title="Create an account"
        description="Passengers request rides; drivers drive."
      />

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
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
            <option value="PASSENGER">Passenger</option>
            <option value="DRIVER">Driver</option>
          </SelectField>

          {error !== null && (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          <Button type="submit" pending={pending} className="w-full">
            Create account
          </Button>
        </form>
      </Card>

      <Notice>
        A driver account alone cannot create a ride: phase 5 adds the Tesla registry and the online
        toggle those pools need.
      </Notice>

      <p className="text-sm text-slate-600">
        Already registered?{' '}
        <Link className="font-medium text-emerald-700" href="/login">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
