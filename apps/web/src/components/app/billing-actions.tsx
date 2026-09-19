'use client';

import { useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import { Button, ButtonLink } from '../ui/button';

export function BillingActions({ hasSubscription }: { hasSubscription: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ url: string }>('/api/billing/portal', { method: 'POST' });
      window.location.href = response.url;
    } catch (portalError) {
      setError(portalError instanceof ApiError ? portalError.message : 'Could not open billing.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <ButtonLink href="/pricing" variant={hasSubscription ? 'ghost' : 'primary'} size="sm">
          {hasSubscription ? 'Change plan' : 'Upgrade'}
        </ButtonLink>
        {hasSubscription ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={openPortal}>
            Manage billing
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
