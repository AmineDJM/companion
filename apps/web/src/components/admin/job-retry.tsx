'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';

/** Retries a failed job. Completed jobs are never re-run. */
export function JobRetryButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await apiFetch('/api/admin/jobs/retry', { method: 'POST', json: { jobId } });
            router.refresh();
          } catch (retryError) {
            setError(retryError instanceof ApiError ? retryError.message : 'Retry failed.');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-[7px] border border-[color:var(--admin-line)] px-2 py-0.5 text-[11.5px] text-[color:var(--color-admin-ink)] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? '…' : 'Retry'}
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
