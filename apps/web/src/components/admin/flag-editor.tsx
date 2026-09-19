'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLAN_KEYS, type PlanKey } from '@companion/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { AdminBadge, AdminCard } from './shell';

export function FlagEditor({
  flag,
}: {
  flag: {
    key: string;
    description: string | null;
    enabledGlobally: boolean;
    enabledPlans: PlanKey[];
    enabledWorkspaceIds: string[];
  };
}) {
  const router = useRouter();
  const [enabledGlobally, setEnabledGlobally] = useState(flag.enabledGlobally);
  const [enabledPlans, setEnabledPlans] = useState<PlanKey[]>(flag.enabledPlans);
  const [workspaceIds, setWorkspaceIds] = useState(flag.enabledWorkspaceIds.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next?: { enabledGlobally?: boolean; enabledPlans?: PlanKey[] }) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/admin/flags', {
        method: 'PUT',
        json: {
          key: flag.key,
          enabledGlobally: next?.enabledGlobally ?? enabledGlobally,
          enabledPlans: next?.enabledPlans ?? enabledPlans,
          enabledWorkspaceIds: workspaceIds
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard
      title={flag.key}
      action={
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const next = !enabledGlobally;
            setEnabledGlobally(next);
            void save({ enabledGlobally: next });
          }}
          className={`rounded-[7px] px-2.5 py-0.5 text-[11.5px] transition-colors ${
            enabledGlobally
              ? 'bg-success/20 text-success'
              : 'border border-[color:var(--admin-line)] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]'
          }`}
        >
          {enabledGlobally ? 'Enabled globally' : 'Off globally'}
        </button>
      }
    >
      {flag.description ? (
        <p className="mb-3 text-[12px] text-[color:var(--color-admin-muted)]">{flag.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-[color:var(--color-admin-muted)]">Plans:</span>
        {PLAN_KEYS.map((planKey) => {
          const on = enabledPlans.includes(planKey);
          return (
            <button
              key={planKey}
              type="button"
              disabled={busy || enabledGlobally}
              onClick={() => {
                const next = on
                  ? enabledPlans.filter((value) => value !== planKey)
                  : [...enabledPlans, planKey];
                setEnabledPlans(next);
                void save({ enabledPlans: next });
              }}
              className={`rounded-[6px] px-2 py-0.5 text-[11.5px] transition-colors disabled:opacity-50 ${
                on
                  ? 'bg-accent/20 text-accent'
                  : 'border border-[color:var(--admin-line)] text-[color:var(--color-admin-muted)]'
              }`}
            >
              {planKey}
            </button>
          );
        })}
        {flag.enabledWorkspaceIds.length > 0 ? (
          <AdminBadge tone="accent">{flag.enabledWorkspaceIds.length} workspaces</AdminBadge>
        ) : null}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11.5px] text-[color:var(--color-admin-muted)]">
          Specific workspaces
        </summary>
        <textarea
          value={workspaceIds}
          onChange={(event) => setWorkspaceIds(event.target.value)}
          rows={3}
          placeholder="One workspace id per line"
          aria-label={`Workspace ids for ${flag.key}`}
          className="mt-2 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="mt-2 h-7 rounded-[7px] bg-accent px-3 text-[11.5px] font-[500] text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Save workspaces
        </button>
      </details>

      {error ? <p className="mt-2 text-[11.5px] text-danger">{error}</p> : null}
    </AdminCard>
  );
}
