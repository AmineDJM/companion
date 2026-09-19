'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLAN_KEYS, USAGE_ADJUSTMENT_TYPES, type PlanKey } from '@companion/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { AdminCard } from './shell';

/**
 * Operator actions on one customer.
 *
 * Every mutation requires a reason, shows a confirmation, and is written to the
 * audit log. Nothing here edits history: granting questions appends a ledger
 * adjustment rather than changing what was consumed.
 */
const QUICK_GRANTS = [100, 500, 2_500, 10_000];

export function CustomerActions({
  workspaceId,
  status,
  planKey,
  uploadsDisabled,
  aiDisabled,
}: {
  workspaceId: string;
  status: string;
  planKey: PlanKey;
  uploadsDisabled: boolean;
  aiDisabled: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [type, setType] = useState<string>('ADMIN_BONUS');
  const [recurring, setRecurring] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [overridePlan, setOverridePlan] = useState<string>(planKey);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
    }
  };

  const grant = (value: number) =>
    run('grant', async () => {
      if (!reason.trim()) throw new ApiError('validation_failed', 'A reason is required.', 422);
      if (
        !window.confirm(
          `Grant ${value > 0 ? '+' : ''}${value.toLocaleString()} questions to this workspace?\n\nReason: ${reason}`,
        )
      ) {
        return;
      }
      await apiFetch('/api/admin/quota', {
        method: 'POST',
        json: {
          workspaceId,
          type,
          amount: value,
          reason: reason.trim(),
          recurring,
          ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59Z`).toISOString() } : {}),
        },
      });
      setMessage({ tone: 'ok', text: `Granted ${value.toLocaleString()} questions.` });
      setAmount('');
      setReason('');
    });

  return (
    <>
      <AdminCard title="Grant questions">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_GRANTS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy !== null}
                onClick={() => void grant(value)}
                className="rounded-[8px] border border-[color:var(--admin-line)] px-2.5 py-1 text-[12px] text-[color:var(--color-admin-ink)] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                +{value.toLocaleString()}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Custom amount"
              aria-label="Custom question amount"
              className="h-8 min-w-0 flex-1 rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={busy !== null || !amount}
              onClick={() => void grant(Number.parseInt(amount, 10))}
              className="h-8 rounded-[8px] bg-accent px-3 text-[12.5px] font-[500] text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              Apply
            </button>
          </div>

          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Adjustment type"
            className="h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
          >
            {USAGE_ADJUSTMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>

          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (required)"
            aria-label="Reason"
            className="h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
          />

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--color-admin-muted)]">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
                className="size-3.5 accent-[color:var(--color-accent)]"
              />
              Every cycle
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              aria-label="Expires on"
              className="h-8 flex-1 rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2 text-[12px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Plan override">
        <div className="space-y-2.5">
          <select
            value={overridePlan}
            onChange={(event) => setOverridePlan(event.target.value)}
            aria-label="Override plan"
            className="h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
          >
            {PLAN_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('plan', async () => {
                if (!reason.trim()) {
                  throw new ApiError('validation_failed', 'Enter a reason above first.', 422);
                }
                if (!window.confirm(`Override this workspace to the ${overridePlan} plan?`)) return;
                await apiFetch('/api/admin/plan-override', {
                  method: 'POST',
                  json: { workspaceId, planKey: overridePlan, reason: reason.trim() },
                });
                setMessage({ tone: 'ok', text: `Plan override applied: ${overridePlan}.` });
              })
            }
            className="h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] text-[12.5px] text-[color:var(--color-admin-ink)] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Apply override
          </button>
          <p className="text-[11px] text-[color:var(--color-admin-muted)]">
            Overrides entitlements without touching the Stripe subscription.
          </p>
        </div>
      </AdminCard>

      <AdminCard title="Account controls">
        <div className="space-y-2">
          <ActionButton
            label={status === 'suspended' ? 'Reactivate workspace' : 'Suspend workspace'}
            danger={status !== 'suspended'}
            busy={busy === 'status'}
            onClick={() =>
              void run('status', async () => {
                const next = status === 'suspended' ? 'active' : 'suspended';
                if (!reason.trim()) {
                  throw new ApiError('validation_failed', 'Enter a reason above first.', 422);
                }
                if (!window.confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} this workspace?`)) {
                  return;
                }
                await apiFetch('/api/admin/workspace-status', {
                  method: 'POST',
                  json: { workspaceId, status: next, reason: reason.trim() },
                });
              })
            }
          />
          <ActionButton
            label={uploadsDisabled ? 'Enable uploads' : 'Disable uploads'}
            busy={busy === 'uploads'}
            onClick={() =>
              void run('uploads', async () => {
                await apiFetch('/api/admin/workspace-switches', {
                  method: 'POST',
                  json: { workspaceId, uploadsDisabled: !uploadsDisabled },
                });
              })
            }
          />
          <ActionButton
            label={aiDisabled ? 'Enable questions' : 'Disable questions'}
            busy={busy === 'ai'}
            onClick={() =>
              void run('ai', async () => {
                await apiFetch('/api/admin/workspace-switches', {
                  method: 'POST',
                  json: { workspaceId, aiDisabled: !aiDisabled },
                });
              })
            }
          />
        </div>
      </AdminCard>

      <AdminCard title="Add internal note">
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Granted +5k questions after the support issue on…"
            aria-label="Internal note"
            className="w-full resize-y rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 py-2 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={busy !== null || !note.trim()}
            onClick={() =>
              void run('note', async () => {
                await apiFetch('/api/admin/note', {
                  method: 'POST',
                  json: { workspaceId, body: note.trim() },
                });
                setNote('');
                setMessage({ tone: 'ok', text: 'Note added.' });
              })
            }
            className="h-8 w-full rounded-[8px] bg-accent text-[12.5px] font-[500] text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      </AdminCard>

      {message ? (
        <p
          role="status"
          className={`text-[12px] ${message.tone === 'ok' ? 'text-success' : 'text-danger'}`}
        >
          {message.text}
        </p>
      ) : null}
    </>
  );
}

function ActionButton({
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
