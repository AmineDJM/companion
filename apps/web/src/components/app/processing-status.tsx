'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { ProcessingPanel } from '../create-flow';

interface StatusResponse {
  status: string;
  progress: number;
  step: string | null;
  error: string | null;
  failures: { name: string; message: string | null }[];
}

/**
 * Polls processing state so the sender can leave the page and come back.
 * Job state lives in the database, so a refresh never loses progress.
 */
export function ProcessingStatus({
  companionId,
  initialProgress,
}: {
  companionId: string;
  initialProgress: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [failure, setFailure] = useState<{ name: string; message: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let delay = 1_500;

    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await apiFetch<StatusResponse>(`/api/companions/${companionId}/status`);
        if (cancelled) return;
        setProgress(status.progress);
        setFailure(status.failures[0] ?? null);

        if (status.status !== 'PROCESSING') {
          router.refresh();
          return;
        }
      } catch {
        // Back off on transient errors rather than hammering the server.
        delay = Math.min(delay * 2, 15_000);
      }
      setTimeout(() => void poll(), delay);
    };

    const timer = setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [companionId, router]);

  return (
    <ProcessingPanel
      progress={progress}
      error={failure?.message ?? null}
      fileName={failure?.name ?? null}
    />
  );
}
