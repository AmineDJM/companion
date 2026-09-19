'use client';

import { clsx } from 'clsx';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

const CONTROL =
  'w-full rounded-[12px] border border-line bg-surface px-3.5 text-[14px] text-ink placeholder:text-ink-subtle transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/18 disabled:bg-surface-sunken disabled:text-ink-muted';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[13px] font-[500] text-ink">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string | null }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={clsx(CONTROL, 'h-10', error && 'border-danger focus:border-danger focus:ring-danger/18', className)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string | null;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={clsx(CONTROL, 'min-h-24 resize-y py-2.5 leading-relaxed', className)}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string | null;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <select {...rest} id={inputId} className={clsx(CONTROL, 'h-10 pr-9', className)}>
        {children}
      </select>
    </Field>
  );
}

/** Accessible switch. Renders as a real checkbox for screen readers. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  name,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-[14px] font-[500] text-ink">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        name={name}
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150',
          checked ? 'bg-accent' : 'bg-line-strong',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={clsx(
            'inline-block size-4.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
            checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
          )}
          style={{ width: 18, height: 18 }}
        />
      </button>
    </div>
  );
}

/** Segmented control used for expiration presets and the billing interval. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex rounded-[12px] border border-line bg-surface-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-[10px] px-3 py-1.5 text-[13px] font-[480] transition-colors duration-150',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(21,22,26,0.06)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
