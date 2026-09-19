'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { clsx } from 'clsx';
import type { AccessMode } from '@companion/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { DownloadIcon, EyeOffIcon } from '../ui/icons';
import { Spinner } from '../ui/button';

/**
 * Turns downloads on or off in one click.
 *
 * This is the control senders reach for most, and it used to live two pages
 * away behind a form and a Save button. It applies immediately and to the link
 * that has already been sent, which is the whole point: deciding a document
 * should stop being downloadable is usually something you realise *after*
 * sharing it.
 */
export function DownloadToggle({
  companionId,
  accessMode,
  initialAllowed,
}: {
  companionId: string;
  /** Sent unchanged: the access endpoint updates the whole policy at once. */
  accessMode: AccessMode;
  initialAllowed: boolean;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(initialAllowed);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    const next = !allowed;
    setError(null);
    setSaving(true);
    // Optimistic: the round trip is short and the control should feel like a
    // switch, not a form. Reverted below if the server disagrees.
    setAllowed(next);

    try {
      // The access policy endpoint, not the Companion one: downloads are part
      // of what a recipient may do, and that is where the entitlement and
      // audit rules live.
      await apiFetch(`/api/companions/${companionId}/access`, {
        method: 'PATCH',
        json: { accessMode, downloadAllowed: next },
      });
      startTransition(() => router.refresh());
    } catch (saveError) {
      setAllowed(!next);
      setError(
        saveError instanceof ApiError ? saveError.message : 'Could not change this setting.',
      );
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || pending;

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={allowed}
        className={clsx(
          'flex w-full items-start gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors',
          allowed
            ? 'border-line bg-surface hover:border-line-strong'
            : 'border-accent bg-accent-soft/50',
          busy && 'opacity-70',
        )}
      >
        <span className="mt-0.5 shrink-0 text-ink-muted">
          {busy ? (
            <Spinner className="size-4" />
          ) : allowed ? (
            <DownloadIcon size={16} />
          ) : (
            <EyeOffIcon size={16} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-[500] text-ink">
            {allowed ? 'Downloads are on' : 'Downloads are off'}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">
            {allowed
              ? 'Recipients can save the original file. Tap to make it read-only.'
              : 'Recipients read page images; the original file is never sent to their browser. No web viewer can stop a screenshot, and we do not claim otherwise.'}
          </span>
        </span>
        <span
          className={clsx(
            'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors',
            allowed ? 'bg-accent' : 'bg-line-strong',
          )}
        >
          <span
            className={clsx(
              'size-4 rounded-full bg-white transition-transform',
              allowed && 'translate-x-4',
            )}
          />
        </span>
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
