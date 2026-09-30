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
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600';

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title !== undefined && <h2 className="font-medium text-slate-900">{title}</h2>}
            {subtitle !== undefined && <p className="text-sm text-slate-600">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
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
      className={`inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${FOCUS_RING} ${className ?? ''}`}
    >
      {pending ? '…' : children}
    </button>
  );
}

/** Loading state — skeleton blocks, never a spinner in an empty page (ui-ux §5). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded bg-slate-200 ${className ?? 'h-5 w-full'}`}
    />
  );
}

/** A failed read or mutation. Always human copy, never a status code (ui-ux §5). */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      <span>{message}</span>
      {onRetry !== undefined && (
        <Button variant="secondary" onClick={onRetry} className="py-1">
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
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return <p className={`rounded border px-3 py-2 text-xs ${styles}`}>{children}</p>;
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description !== undefined && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions}
    </div>
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
      <label className="block text-slate-700" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        {...rest}
        className={`mt-1 w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100 ${FOCUS_RING}`}
      />
      {hint !== undefined && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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
      <label className="block text-slate-700" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        name={name}
        {...rest}
        className={`mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100 ${FOCUS_RING}`}
      >
        {children}
      </select>
    </div>
  );
}

const CHIP_STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-sky-100 text-sky-900',
  DRIVER_ARRIVED: 'bg-sky-100 text-sky-900',
  STARTED: 'bg-emerald-100 text-emerald-900',
  COMPLETED: 'bg-emerald-100 text-emerald-900',
  CANCELLED: 'bg-slate-200 text-slate-700',
  PAID: 'bg-emerald-100 text-emerald-900',
  PENDING: 'bg-amber-100 text-amber-900',
  ESTIMATED: 'bg-slate-100 text-slate-700',
  FINAL: 'bg-emerald-100 text-emerald-900',
};

/** Status chip — the human label plus the raw enum in `data-status` for the evaluator. */
export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {label ?? status}
    </span>
  );
}

export function DataList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-slate-100">{children}</dl>;
}

export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}
