import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={clsx('card', padded && 'p-6', className)}>{children}</div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A label above the fold of a page: small, uppercase, unobtrusive. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        'text-[11px] font-[560] uppercase tracking-[0.13em] text-ink-subtle',
        className,
      )}
    >
      {children}
    </p>
  );
}

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-[520] tracking-[0.01em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const color =
    tone === 'success'
      ? 'bg-success'
      : tone === 'danger'
        ? 'bg-danger'
        : tone === 'warning'
          ? 'bg-warning'
          : tone === 'accent'
            ? 'bg-accent'
            : 'bg-ink-subtle';
  return <span className={clsx('inline-block size-1.5 rounded-full', color)} aria-hidden="true" />;
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0', className)}>
      <p className="text-[12.5px] text-ink-muted">{label}</p>
      <p className="mt-1.5 text-[26px] font-[560] tracking-[-0.03em] text-ink tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[12px] text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center rounded-[18px] border border-dashed border-line px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-4 text-ink-subtle">{icon}</div> : null}
      <p className="text-[15px] font-[520] text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-muted text-pretty">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx('border-0 border-t border-line', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
      {children}
    </kbd>
  );
}

/** Small monospaced link/id display, e.g. a share slug. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('font-mono text-[12.5px] tracking-tight', className)}>{children}</span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('shimmer rounded-[10px]', className)} aria-hidden="true" />;
}

export function ProgressBar({
  value,
  tone = 'accent',
  className,
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill =
    tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : tone === 'success' ? 'bg-success' : 'bg-accent';
  return (
    <div
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]', fill)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
