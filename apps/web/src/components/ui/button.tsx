'use client';

import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover shadow-[0_1px_2px_rgba(21,22,26,0.12)] disabled:bg-accent/45',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-sunken/60',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-sunken',
  danger: 'bg-danger text-white hover:bg-danger/90',
  subtle: 'bg-accent-soft text-accent hover:bg-accent-line/60',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[10px] gap-1.5',
  md: 'h-10 px-4 text-[14px] rounded-[12px] gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-[14px] gap-2',
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center font-[480] transition-colors duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  prefetch,
}: BaseProps & { href: string; prefetch?: boolean }) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={clsx(
        'inline-flex items-center justify-center font-[480] transition-colors duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
