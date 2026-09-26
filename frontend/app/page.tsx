import Link from 'next/link';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Placeholder landing page for the Phase 1 scaffold. The real routing rules
 * (`/` → passenger or driver dashboard by role, guest → `/login`) arrive with the
 * passenger/driver flows in Phase 10 — see docs/ui-ux.md §2.
 */
export default function HomePage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Dhaka Tesla Pool</h1>
        <p className="mt-2 text-slate-700">
          One Tesla, three bookable seats, deterministic matching over Dhaka zones, individual
          fares in integer poisha, and a seat claim that two passengers cannot both win.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">The cast</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>
            <strong>Jashim</strong> — driver of Bullet
          </li>
          <li>
            <strong>Bullet</strong> — Tesla Model 3, DHK-TSL-001, 3 seats
          </li>
          <li>
            <strong>Nusrat</strong>, <strong>Rafiq</strong>, <strong>Shirin</strong> — passengers
            on Banani → Dhanmondi
          </li>
        </ul>
      </section>

      <section className="flex flex-wrap gap-3 text-sm">
        <Link
          className="rounded bg-slate-900 px-3 py-2 font-medium text-white"
          href="/login"
        >
          Login (Phase 3)
        </Link>
        <a
          className="rounded border border-slate-300 px-3 py-2 font-medium"
          href={`${apiUrl}/api/v1/health`}
        >
          API health
        </a>
      </section>

      <p className="text-xs text-slate-500">
        Implementation status lives in <code>todo.md</code>; behaviour is specified in{' '}
        <code>docs/</code>.
      </p>
    </div>
  );
}
