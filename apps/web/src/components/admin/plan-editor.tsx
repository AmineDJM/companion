'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ANALYTICS_LEVELS, formatBytes, type Entitlements } from '@companion/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { AdminBadge, AdminCard } from './shell';

/**
 * Plan entitlement editor.
 *
 * Every field on the Entitlements type is editable, so a new capability added
 * to the type appears here automatically rather than needing UI work.
 */
const NUMERIC_FIELDS: { key: keyof Entitlements; label: string; unit?: 'bytes' }[] = [
  { key: 'maxActiveCompanions', label: 'Active Companions' },
  { key: 'monthlyQuestions', label: 'Questions / month' },
  { key: 'maxUploadBytes', label: 'Max upload', unit: 'bytes' },
  { key: 'storageBytes', label: 'Storage', unit: 'bytes' },
  { key: 'maxFilesPerCompanion', label: 'Files per Companion' },
  { key: 'maxTeamMembers', label: 'Team members' },
];

const BOOLEAN_FIELDS: { key: keyof Entitlements; label: string }[] = [
  { key: 'passwordProtection', label: 'Password protection' },
  { key: 'emailListAccess', label: 'Specific-people access' },
  { key: 'identifiedAccess', label: 'Identified access' },
  { key: 'customExpiration', label: 'Custom expiration' },
  { key: 'removeBranding', label: 'Remove branding' },
  { key: 'customBranding', label: 'Custom branding' },
  { key: 'replaceDocuments', label: 'Replace documents' },
  { key: 'priorityProcessing', label: 'Priority processing' },
  { key: 'customDomains', label: 'Custom domains' },
  { key: 'apiAccess', label: 'API access' },
];

export function PlanEditor({
  plan,
}: {
  plan: {
    key: string;
    displayName: string;
    tagline: string;
    monthlyPrice: string;
    annualPrice: string;
    entitlements: Entitlements;
    highlights: string[];
    isPublic: boolean;
    stripeMonthlyPriceId: string | null;
    stripeAnnualPriceId: string | null;
  };
}) {
  const router = useRouter();
  const [entitlements, setEntitlements] = useState<Entitlements>(plan.entitlements);
  const [monthlyPriceId, setMonthlyPriceId] = useState(plan.stripeMonthlyPriceId ?? '');
  const [annualPriceId, setAnnualPriceId] = useState(plan.stripeAnnualPriceId ?? '');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/admin/plans', {
        method: 'PATCH',
        json: {
          planKey: plan.key,
          entitlements,
          stripeMonthlyPriceId: monthlyPriceId || null,
          stripeAnnualPriceId: annualPriceId || null,
        },
      });
      setMessage({ tone: 'ok', text: 'Entitlements saved. They apply immediately.' });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not save.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard
      title={`${plan.displayName} · ${plan.monthlyPrice}/mo · ${plan.annualPrice}/yr`}
      action={
        <div className="flex items-center gap-2">
          {plan.isPublic ? <AdminBadge tone="good">public</AdminBadge> : <AdminBadge>hidden</AdminBadge>}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="rounded-[7px] border border-[color:var(--admin-line)] px-2 py-0.5 text-[11.5px] text-[color:var(--color-admin-ink)] hover:border-accent hover:text-accent"
          >
            {open ? 'Close' : 'Edit entitlements'}
          </button>
        </div>
      }
    >
      {!open ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-[color:var(--color-admin-muted)]">
          <span>
            {entitlements.maxActiveCompanions === null
              ? 'Unlimited'
              : entitlements.maxActiveCompanions}{' '}
            Companions
          </span>
          <span>{entitlements.monthlyQuestions.toLocaleString()} questions/mo</span>
          <span>{formatBytes(entitlements.storageBytes)} storage</span>
          <span>{formatBytes(entitlements.maxUploadBytes)} max upload</span>
          <span>{entitlements.analyticsLevel} analytics</span>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {NUMERIC_FIELDS.map((field) => {
              const value = entitlements[field.key] as number | null;
              return (
                <label key={String(field.key)} className="block">
                  <span className="block text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {field.label}
                    {field.unit === 'bytes' && value !== null ? ` (${formatBytes(value)})` : ''}
                  </span>
                  <input
                    type="number"
                    value={value ?? ''}
                    placeholder={field.key === 'maxActiveCompanions' ? 'blank = unlimited' : ''}
                    onChange={(event) =>
                      setEntitlements((current) => ({
                        ...current,
                        [field.key]:
                          event.target.value === '' && field.key === 'maxActiveCompanions'
                            ? null
                            : Number.parseInt(event.target.value, 10) || 0,
                      }))
                    }
                    className="mt-1 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[12.5px] tabular-nums text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
                  />
                </label>
              );
            })}

            <label className="block">
              <span className="block text-[11.5px] text-[color:var(--color-admin-muted)]">
                Analytics level
              </span>
              <select
                value={entitlements.analyticsLevel}
                onChange={(event) =>
                  setEntitlements((current) => ({
                    ...current,
                    analyticsLevel: event.target.value as Entitlements['analyticsLevel'],
                  }))
                }
                className="mt-1 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2 text-[12.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
              >
                {ANALYTICS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-3">
            {BOOLEAN_FIELDS.map((field) => (
              <label
                key={String(field.key)}
                className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-admin-ink)]"
              >
                <input
                  type="checkbox"
                  checked={Boolean(entitlements[field.key])}
                  onChange={(event) =>
                    setEntitlements((current) => ({
                      ...current,
                      [field.key]: event.target.checked,
                    }))
                  }
                  className="size-3.5 accent-[color:var(--color-accent)]"
                />
                {field.label}
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[11.5px] text-[color:var(--color-admin-muted)]">
                Stripe monthly price id
              </span>
              <input
                value={monthlyPriceId}
                onChange={(event) => setMonthlyPriceId(event.target.value)}
                placeholder="price_…"
                className="mt-1 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 font-mono text-[11.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11.5px] text-[color:var(--color-admin-muted)]">
                Stripe annual price id
              </span>
              <input
                value={annualPriceId}
                onChange={(event) => setAnnualPriceId(event.target.value)}
                placeholder="price_…"
                className="mt-1 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 font-mono text-[11.5px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-8 rounded-[8px] bg-accent px-4 text-[12.5px] font-[500] text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save entitlements'}
            </button>
            {message ? (
              <span
                className={`text-[12px] ${message.tone === 'ok' ? 'text-success' : 'text-danger'}`}
              >
                {message.text}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </AdminCard>
  );
}
