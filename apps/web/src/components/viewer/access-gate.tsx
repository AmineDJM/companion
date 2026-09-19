'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '../../lib/api';
import { Button } from '../ui/button';
import { TextInput } from '../ui/fields';
import { CompanionMark } from '../ui/logo';
import { LockIcon } from '../ui/icons';

/**
 * The only thing that ever stands between a recipient and their document.
 *
 * Deliberately plain: no product pitch, no account prompt. When identity is
 * required the copy says outright that the sender will know who opened it —
 * recipients are never quietly de-anonymised.
 */
export function AccessGate({
  slug,
  mode,
  senderLabel,
}: {
  slug: string;
  mode: 'password' | 'identity';
  senderLabel: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/c/${slug}/unlock`, { method: 'POST', json: { password } });
      router.refresh();
    } catch (unlockError) {
      setError(unlockError instanceof ApiError ? unlockError.message : 'Incorrect password.');
    } finally {
      setBusy(false);
    }
  };

  const submitIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'request') {
        await apiFetch(`/api/c/${slug}/identity`, {
          method: 'POST',
          json: { step: 'request', email },
        });
        setStep('confirm');
      } else {
        await apiFetch(`/api/c/${slug}/identity`, {
          method: 'POST',
          json: { step: 'confirm', email, code },
        });
        router.refresh();
      }
    } catch (identityError) {
      setError(
        identityError instanceof ApiError ? identityError.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="card p-7">
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-accent-soft text-accent">
            <LockIcon size={19} />
          </span>

          {mode === 'password' ? (
            <>
              <h1 className="mt-5 text-[19px] text-ink">This document is protected</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                Enter the password {senderLabel ? `${senderLabel} shared` : 'you were given'} to
                continue.
              </p>
              <form onSubmit={submitPassword} className="mt-6 space-y-4">
                <TextInput
                  type="password"
                  label="Password"
                  autoComplete="off"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={error}
                  required
                />
                <Button type="submit" loading={busy} className="w-full" size="lg">
                  Open document
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-[19px] text-ink">
                {step === 'request' ? 'Confirm your email' : 'Enter your code'}
              </h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                {step === 'request'
                  ? `This document was shared with specific people. ${senderLabel ?? 'The sender'} will be able to see that you opened it.`
                  : `We sent a six-digit code to ${email}. It expires in 15 minutes.`}
              </p>
              <form onSubmit={submitIdentity} className="mt-6 space-y-4">
                {step === 'request' ? (
                  <TextInput
                    type="email"
                    label="Email address"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    error={error}
                    required
                  />
                ) : (
                  <TextInput
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    label="Six-digit code"
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    error={error}
                    className="text-center text-[18px] tracking-[0.4em]"
                    required
                  />
                )}
                <Button type="submit" loading={busy} className="w-full" size="lg">
                  {step === 'request' ? 'Send me a code' : 'Open document'}
                </Button>
                {step === 'confirm' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStep('request');
                      setCode('');
                      setError(null);
                    }}
                    className="w-full text-[12.5px] text-ink-muted transition-colors hover:text-ink"
                  >
                    Use a different address
                  </button>
                ) : null}
              </form>
            </>
          )}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px] text-ink-subtle">
          <CompanionMark size={12} />
          Shared through Companion
        </p>
      </div>
    </div>
  );
}
