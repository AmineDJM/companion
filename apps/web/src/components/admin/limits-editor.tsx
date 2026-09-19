'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatBytes, type PlatformLimits } from '@companion/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { AdminCard } from './shell';

const GROUPS: { title: string; fields: { key: keyof PlatformLimits; label: string; unit?: 'bytes' }[] }[] = [
  {
    title: 'Uploads',
    fields: [
      { key: 'maxFileBytes', label: 'Max single file', unit: 'bytes' },
      { key: 'maxBatchBytes', label: 'Max upload batch', unit: 'bytes' },
      { key: 'maxFilesPerCompanion', label: 'Max files per Companion' },
      { key: 'maxUnitsPerFile', label: 'Max pages indexed per file' },
    ],
  },
  {
    title: 'Archives',
    fields: [
      { key: 'maxArchiveExtractedBytes', label: 'Max extracted size', unit: 'bytes' },
      { key: 'maxCompressionRatio', label: 'Max compression ratio' },
      { key: 'maxArchiveEntries', label: 'Max entries' },
      { key: 'maxArchiveDepth', label: 'Max nesting depth' },
    ],
  },
  {
    title: 'Rate limits',
    fields: [
      { key: 'maxQuestionsPerMinutePerSession', label: 'Questions / min / session' },
      { key: 'maxQuestionsPerMinutePerWorkspace', label: 'Questions / min / workspace' },
      { key: 'maxQuestionsPerSession', label: 'Questions / session' },
      { key: 'maxSessionsPerCompanionPerHour', label: 'Sessions / Companion / hour' },
      { key: 'maxAuthAttemptsPerWindow', label: 'Login attempts / 15 min' },
      { key: 'maxPasswordAttemptsPerWindow', label: 'Password attempts / 15 min' },
    ],
  },
  {
    title: 'Cost protection',
    fields: [
      { key: 'maxAnswerInputTokens', label: 'Max input tokens / request' },
      { key: 'maxAnswerOutputTokens', label: 'Max output tokens / answer' },
      { key: 'maxRetrievalChunks', label: 'Max retrieved passages' },
      { key: 'workspaceMonthlySpendAlertUsd', label: 'Spend alert threshold (USD)' },
      { key: 'workspaceMonthlySpendHardCapUsd', label: 'Hard spend cap (USD)' },
    ],
  },
];

export function LimitsEditor({ initial }: { initial: PlatformLimits }) {
  const router = useRouter();
  const [limits, setLimits] = useState<PlatformLimits>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/admin/limits', { method: 'PATCH', json: limits });
      setMessage({ tone: 'ok', text: 'Limits saved. They take effect within a minute.' });
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
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <AdminCard key={group.title} title={group.title}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map((field) => {
              const value = limits[field.key];
              return (
                <label key={String(field.key)} className="block">
                  <span className="block text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {field.label}
                    {field.unit === 'bytes' ? ` (${formatBytes(value)})` : ''}
                  </span>
                  <input
                    type="number"
                    step={field.key.includes('Ratio') || field.key.includes('Usd') ? '0.01' : '1'}
                    value={value}
                    onChange={(event) =>
                      setLimits((current) => ({
                        ...current,
                        [field.key]: Number.parseFloat(event.target.value) || 0,
                      }))
                    }
                    className="mt-1 h-8 w-full rounded-[8px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[12.5px] tabular-nums text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
                  />
                </label>
              );
            })}
          </div>
        </AdminCard>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="h-9 rounded-[9px] bg-accent px-5 text-[13px] font-[500] text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save limits'}
        </button>
        {message ? (
          <span className={`text-[12.5px] ${message.tone === 'ok' ? 'text-success' : 'text-danger'}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
