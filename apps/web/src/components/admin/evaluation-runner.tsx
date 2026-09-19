'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

interface RunSummary {
  cases: number;
  recallAt5: number;
  mrr: number;
  passed: boolean;
  misses: string[];
}

/**
 * Runs the golden corpus on demand.
 *
 * Evaluation is otherwise a deploy-time and scheduled activity; this exists so
 * an operator investigating a report can re-measure immediately instead of
 * waiting for the next run.
 */
export function EvaluationRunner() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<RunSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState('running');
    setMessage(null);
    try {
      const summary = await apiFetch<RunSummary>('/api/admin/quality/run', { method: 'POST' });
      setResult(summary);
      setState('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The evaluation could not be run.');
      setState('error');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === 'running'}
        className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-[500] text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {state === 'running' ? 'Measuring…' : 'Run golden corpus'}
      </button>
      {state === 'done' && result ? (
        <p className="text-[12px] text-[color:var(--color-admin-muted)]">
          {result.cases === 0
            ? 'No golden cases are seeded, so nothing was measured.'
            : `${result.cases} cases · Recall@5 ${(result.recallAt5 * 100).toFixed(1)}% · MRR ${result.mrr.toFixed(3)}`}
        </p>
      ) : null}
      {message ? <p className="text-[12px] text-danger">{message}</p> : null}
    </div>
  );
}
