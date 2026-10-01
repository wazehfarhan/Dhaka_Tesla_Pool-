'use client';

/**
 * The whole design system (ui-ux §1: "no design system, no storybook" — just
 * honest primitives with one accent colour).
 *
 * Each primitive exists because ui-ux §5 demands a state: skeletons for loading,
 * `role="alert"` banners for errors, `aria-busy` + disabled buttons for
 * in-flight mutations (double-click prevention), and an empty state that is
 * never a blank screen.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** The one card every panel uses — `surface` in globals.css carries the styling. */
export function Card({
  title,
  subtitle,
  actions,
  tone = 'plain',
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  /** `accent` marks the one card a screen is really about (the live trip). */
  tone?: 'plain' | 'accent';
  children: ReactNode;
}) {
  return (
    <section
      className={`surface p-5 sm:p-6 ${
        tone === 'accent' ? 'ring-1 ring-brand-600/20 shadow-[var(--shadow-lift)]' : ''
      }`}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
            )}
            {subtitle !== undefined && (
              <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{subtitle}</p>
            )}
          </div>
          {actions !== undefined && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 active:bg-brand-800',
  secondary:
    'border border-ink-900/10 bg-white text-ink-800 shadow-xs hover:border-ink-900/20 hover:bg-ink-50',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  ghost: 'text-ink-600 hover:bg-ink-900/5 hover:text-ink-900',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows `…` and disables — the mutation is in flight (ui-ux §5). */
  pending?: boolean;
}

export function Button({
  variant = 'primary',
  pending = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={rest.disabled === true || pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${FOCUS_RING} ${className ?? ''}`}
    >
      {pending ? '…' : children}
    </button>
  );
}

/** Loading state — shimmering skeleton blocks, never a spinner in an empty page (ui-ux §5). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={`shimmer rounded-lg ${className ?? 'h-5 w-full'}`} />;
}

/** A failed read or mutation. Always human copy, never a status code (ui-ux §5). */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <span className="flex items-center gap-2 font-medium">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.5a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4ZM10 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
            clipRule="evenodd"
          />
        </svg>
        {message}
      </span>
      {onRetry !== undefined && (
        <Button variant="secondary" onClick={onRetry} className="py-1.5">
          Retry
        </Button>
      )}
    </div>
  );
}

/** Neutral informational note — used for "this lands with Phase 5/8" and API caveats. */
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warn';
}) {
  const styles =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-sky-100 bg-sky-50/70 text-sky-900';
  return (
    <p
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11.25a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 6.75Zm0 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
          clipRule="evenodd"
        />
      </svg>
      <span>{children}</span>
    </p>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink-900/10 bg-ink-50/50 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-800">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
      </div>
      {action !== undefined && <div className="mt-1 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  /** Small label above the title — the role, the section, the screen's job. */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-[28px]">{title}</h1>
        {description !== undefined && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/**
 * `Stat` — one number with a label: what turns a list of rows into a dashboard.
 * `tone` tints the value for the states worth spotting instantly (a live trip, an
 * open request).
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'plain' | 'brand' | 'amber';
}) {
  const tones: Record<'plain' | 'brand' | 'amber', string> = {
    plain: 'text-ink-900',
    brand: 'text-brand-700',
    amber: 'text-amber-600',
  };
  return (
    <div className="surface px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/** The brand mark: a bolt in a gradient tile. Header, auth panel, favicon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-sm shadow-brand-600/30 ${className ?? 'h-9 w-9'}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[55%] w-[55%]">
        <path d="M13.2 2 5 13.1h5.1L9.3 22 19 10.2h-5.6L13.2 2Z" />
      </svg>
    </span>
  );
}

/** A corridor, drawn as a route: origin, a rail with an arrowhead, destination. */
export function RouteLine({
  from,
  to,
  className,
}: {
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <span className="font-semibold text-ink-900">{from}</span>
      <span aria-hidden className="relative h-px w-8 shrink-0 bg-ink-900/20">
        <span className="absolute -top-[3px] right-0 h-1.5 w-1.5 rotate-45 border-r border-t border-ink-900/30" />
      </span>
      <span className="font-semibold text-ink-900">{to}</span>
    </span>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/** Labelled input — a11y §8: every control has a real `<label for>`. */
export function TextField({ label, hint, id, name, ...rest }: TextFieldProps) {
  const inputId = id ?? name ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="text-sm">
      <label className="block font-medium text-ink-700" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        {...rest}
        className={`mt-1.5 w-full rounded-xl border border-ink-900/10 bg-white px-3.5 py-2.5 text-ink-900 shadow-xs transition-shadow placeholder:text-ink-400 disabled:bg-ink-50 ${FOCUS_RING}`}
      />
      {hint !== undefined && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

export function SelectField({ label, id, name, children, ...rest }: SelectFieldProps) {
  const selectId = id ?? name ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="text-sm">
      <label className="block font-medium text-ink-700" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        name={name}
        {...rest}
        className={`mt-1.5 w-full rounded-xl border border-ink-900/10 bg-white px-3.5 py-2.5 text-ink-900 shadow-xs disabled:bg-ink-50 ${FOCUS_RING}`}
      >
        {children}
      </select>
    </div>
  );
}

/** Chip tone per status: a dot plus a tint, so colour is never the only signal. */
const CHIP_STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800 ring-amber-200/70',
  ACCEPTED: 'bg-sky-50 text-sky-800 ring-sky-200/70',
  DRIVER_ARRIVED: 'bg-sky-50 text-sky-800 ring-sky-200/70',
  STARTED: 'bg-brand-50 text-brand-800 ring-brand-200/70',
  COMPLETED: 'bg-brand-50 text-brand-800 ring-brand-200/70',
  CANCELLED: 'bg-ink-100 text-ink-600 ring-ink-900/10',
  PAID: 'bg-brand-50 text-brand-800 ring-brand-200/70',
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200/70',
  ESTIMATED: 'bg-ink-100 text-ink-700 ring-ink-900/10',
  FINAL: 'bg-brand-50 text-brand-800 ring-brand-200/70',
};

const CHIP_DOTS: Record<string, string> = {
  REQUESTED: 'bg-amber-500',
  ACCEPTED: 'bg-sky-500',
  DRIVER_ARRIVED: 'bg-sky-500',
  STARTED: 'bg-brand-500',
  COMPLETED: 'bg-brand-500',
  CANCELLED: 'bg-ink-400',
  PAID: 'bg-brand-500',
  PENDING: 'bg-amber-500',
  ESTIMATED: 'bg-ink-400',
  FINAL: 'bg-brand-500',
};

/** Status chip — the human label plus the raw enum in `data-status` for the evaluator. */
export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${CHIP_STYLES[status] ?? 'bg-ink-100 text-ink-700 ring-ink-900/10'}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${CHIP_DOTS[status] ?? 'bg-ink-400'}`}
      />
      {label ?? status}
    </span>
  );
}

export function DataList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-ink-900/5">{children}</dl>;
}

export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-ink-900">{children}</dd>
    </div>
  );
}
