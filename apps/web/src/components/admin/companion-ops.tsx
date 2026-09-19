'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import { AdminCard } from './shell';

/**
 * Operational actions on a Companion. Every one is confirmed, requires a
 * reason and is audited; none of them expose document content.
 */
export function CompanionOpsActions({
  companionId,
  status,
  failedJobs,
}: {
  companionId: string;
  status: string;
  failedJobs: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const act = async (action: string, confirmText: string) => {
    if (!reason.trim()) {
      setMessage({ tone: 'error', text: 'A reason is required.' });
      return;
    }
    if (!window.confirm(confirmText)) return;

    setBusy(action);
    setMessage(null);
    try {
      const response = await apiFetch<{ queued?: number }>('/api/admin/companions', {
        method: 'POST',
        json: { companionId, action, reason: reason.trim() },
      });
      setMessage({
        tone: 'ok',
        text:
          action === 'reprocess'
            ? `Re-queued ${response.queued ?? 0} files.`
            : `Action applied: ${action}.`,
      });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Action failed.',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminCard title="Operational actions">
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (required)"
        aria-label="Reason"
        className="mb-3 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
      />

      <div className="space-y-2">
        <OpsButton
          label={`Reprocess all files${failedJobs > 0 ? ` (${failedJobs} failed)` : ''}`}
          busy={busy === 'reprocess'}
          onClick={() =>
            void act('reprocess', 'Re-queue every file in this Companion for processing?')
          }
        />
        {status === 'PAUSED' || status === 'REVOKED' ? (
          <OpsButton
            label="Reactivate"
            busy={busy === 'reactivate'}
            onClick={() => void act('reactivate', 'Restore access to this Companion?')}
          />
        ) : (
          <OpsButton
            label="Pause access"
            busy={busy === 'pause'}
            onClick={() => void act('pause', 'Pause access to this Companion?')}
          />
        )}
        <OpsButton
          label="Force expire"
          busy={busy === 'force_expire'}
          onClick={() => void act('force_expire', 'Expire this Companion immediately?')}
        />
        <OpsButton
          label="Revoke access"
          danger
          busy={busy === 'revoke'}
          onClick={() =>
            void act('revoke', 'Revoke this Companion? The link stops working immediately.')
          }
        />
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-3 text-[12px] ${message.tone === 'ok' ? 'text-success' : 'text-danger'}`}
        >
          {message.text}
        </p>
      ) : null}
    </AdminCard>
  );
}

function OpsButton({
  label,
  onClick,
  busy,
  danger,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`h-8 w-full rounded-[8px] border text-[12.5px] transition-colors disabled:opacity-50 ${
        danger
          ? 'border-danger/40 text-danger hover:bg-danger/10'
          : 'border-[color:var(--admin-line)] text-[color:var(--color-admin-ink)] hover:border-accent hover:text-accent'
      }`}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}
