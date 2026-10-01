/**
 * `AuthShell` — the frame every guest screen sits in: a dark brand panel that
 * explains the product, and the form itself in a light column beside it.
 *
 * A centred 380 px form on an empty page reads as "unfinished"; the split gives
 * the product a voice before the user has an account, and it collapses to a
 * single column below `lg` where the panel becomes a compact banner.
 */
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/ui';

const HIGHLIGHTS: { title: string; body: string }[] = [
  {
    title: 'One Tesla, several seats',
    body: 'Passengers heading the same way share a single car instead of three cars on the road.',
  },
  {
    title: 'Your seat, your fare',
    body: 'Each passenger keeps their own seat count, status and fare — sharing never merges them.',
  },
  {
    title: 'No overselling, ever',
    body: 'Seats are claimed in the database, so the last seat can only ever be taken once.',
  },
];

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:items-center lg:gap-12">
      <section className="brand-panel overflow-hidden rounded-2xl px-6 py-8 text-white shadow-[var(--shadow-lift)] sm:px-10 sm:py-10">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div>
            <p className="text-[15px] font-bold tracking-tight">Dhaka Tesla Pool</p>
            <p className="text-xs text-white/60">Ride pooling for Dhaka</p>
          </div>
        </div>

        <h2 className="mt-8 max-w-md text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          Fewer cars on the road. The same ride, minus the surge pricing.
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
          Dhaka&rsquo;s fastest-growing corridors already run on pooled rides. This is that idea,
          with the parts that usually break &mdash; seat counts, payments and cancellations &mdash;
          handled in the database rather than in a spreadsheet.
        </p>

        <dl className="mt-8 space-y-4">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold"
              >
                ✓
              </span>
              <div>
                <dt className="text-sm font-semibold">{item.title}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-white/60">{item.body}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto w-full max-w-sm lg:mx-0 lg:ml-auto">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
