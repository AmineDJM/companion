'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import { Button } from './ui/button';
import { TextInput } from './ui/fields';
import { Divider } from './ui/primitives';
import { CheckIcon, FileIcon } from './ui/icons';

/**
 * Sign-up and log-in.
 *
 * Both a password and a magic link are offered; neither is required to have
 * been chosen in advance. When the visitor arrived with files already uploaded
 * we say so, because the account is an interruption and should feel like one
 * that is nearly over.
 */
export function AuthForm({
  mode,
  draftToken,
  pendingFiles,
}: {
  mode: 'signup' | 'login';
  draftToken: string | null;
  pendingFiles: number;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [magicSent, setMagicSent] = useState(false);

  const isSignup = mode === 'signup';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await apiFetch<{ redirectTo: string }>(
        isSignup ? '/api/auth/signup' : '/api/auth/login',
        {
          method: 'POST',
          json: {
            email,
            password,
            ...(isSignup && name.trim() ? { name: name.trim() } : {}),
            ...(draftToken ? { draftToken } : {}),
          },
        },
      );
      router.push(response.redirectTo);
      router.refresh();
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        if (submitError.code === 'validation_failed' && submitError.details) {
          setFieldErrors(submitError.details as Record<string, string>);
        } else {
          setError(submitError.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const sendMagicLink = async () => {
    if (!email.trim()) {
      setFieldErrors({ email: 'Enter your email address first.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/magic', {
        method: 'POST',
        json: { email, ...(draftToken ? { draftToken } : {}) },
      });
      setMagicSent(true);
    } catch (magicError) {
      setError(magicError instanceof ApiError ? magicError.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  };

  if (magicSent) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="card p-8">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckIcon size={19} />
          </span>
          <h1 className="mt-5 text-[19px] text-ink">Check your email</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
            We sent a sign-in link to <span className="text-ink">{email}</span>. It expires in 15
            minutes.
          </p>
          <button
            type="button"
            onClick={() => setMagicSent(false)}
            className="mt-6 text-[13px] text-accent transition-colors hover:text-accent-hover"
          >
            Use a password instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      {pendingFiles > 0 ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-[14px] border border-accent-line bg-accent-soft px-4 py-3">
          <FileIcon size={17} className="shrink-0 text-accent" />
          <p className="text-[13px] leading-snug text-accent">
            {pendingFiles} {pendingFiles === 1 ? 'file is' : 'files are'} waiting. Create your
            account and we will finish building your Companion.
          </p>
        </div>
      ) : null}

      <div className="card p-7">
        <h1 className="text-[21px] text-ink">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          {isSignup
            ? 'Share documents that can answer questions.'
            : 'Log in to your Companions.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {isSignup ? (
            <TextInput
              label="Name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional"
            />
          ) : null}

          <TextInput
            type="email"
            label="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors['email'] ?? null}
          />

          <TextInput
            type="password"
            label="Password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors['password'] ?? null}
            hint={isSignup ? 'At least 10 characters.' : undefined}
          />

          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={busy} size="lg" className="w-full">
            {isSignup ? 'Create account' : 'Log in'}
          </Button>
        </form>

        <Divider className="my-5" />

        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={sendMagicLink}
          disabled={busy}
        >
          Email me a sign-in link
        </Button>
      </div>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        {isSignup ? 'Already have an account? ' : "Don't have an account? "}
        <Link
          href={
            isSignup
              ? `/login${draftToken ? `?draft=${draftToken}` : ''}`
              : `/signup${draftToken ? `?draft=${draftToken}` : ''}`
          }
          className="text-accent transition-colors hover:text-accent-hover"
        >
          {isSignup ? 'Log in' : 'Create one'}
        </Link>
      </p>

      {isSignup ? (
        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-subtle">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink-muted">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-muted">
            Privacy Policy
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
