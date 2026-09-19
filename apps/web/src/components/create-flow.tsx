'use client';

import { PROCESSING_STEPS, formatBytes } from '@companion/shared';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { ApiError, apiFetch, uploadWithProgress } from '../lib/api';
import { Dropzone, type PendingFile } from './dropzone';
import { Button } from './ui/button';
import { TextInput } from './ui/fields';
import { AskGlyph } from './ui/logo';
import { AlertIcon, ArrowRightIcon, CheckIcon } from './ui/icons';

/**
 * The create flow.
 *
 * Works identically for a signed-in sender and an anonymous visitor on the
 * homepage. When the visitor is anonymous the files upload into a draft first;
 * signing up claims that draft, so nothing is ever uploaded twice.
 */
type Phase = 'select' | 'uploading' | 'processing' | 'ready';

export interface CreateFlowProps {
  /** Null for an anonymous visitor on the homepage. */
  authenticated: boolean;
  maxUploadBytes?: number;
  compact?: boolean;
  /** Preset name, e.g. when resuming a claimed draft. */
  initialName?: string;
}

export function CreateFlow({
  authenticated,
  maxUploadBytes,
  compact = false,
  initialName = '',
}: CreateFlowProps) {
  const router = useRouter();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [name, setName] = useState(initialName);
  const [phase, setPhase] = useState<Phase>('select');
  const [error, setError] = useState<string | null>(null);
  const [progressStep] = useState(1);
  const abortRef = useRef<AbortController | null>(null);

  const usableFiles = files.filter((file) => file.status !== 'error');
  const canSubmit = usableFiles.length > 0 && phase === 'select';

  const addFiles = useCallback((incoming: PendingFile[]) => {
    setFiles((current) => [...current, ...incoming]);
    setError(null);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((current) => current.filter((file) => file.id !== id));
  }, []);

  const attach = useCallback(async () => {
    if (usableFiles.length === 0) return;
    setError(null);
    setPhase('uploading');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 1. Reserve the Companion (or an anonymous draft) before uploading.
      const reservation = await apiFetch<{ companionId?: string; draftToken?: string; slug?: string }>(
        authenticated ? '/api/companions' : '/api/drafts',
        {
          method: 'POST',
          json: { name: name.trim() || undefined },
          signal: controller.signal,
        },
      );

      // 2. Upload each file, reporting progress per file.
      for (const item of usableFiles) {
        setFiles((current) =>
          current.map((file) =>
            file.id === item.id ? { ...file, status: 'uploading', progress: 0 } : file,
          ),
        );

        const formData = new FormData();
        formData.append('file', item.file, item.file.name);
        formData.append('relativePath', item.relativePath);

        const endpoint = authenticated
          ? `/api/companions/${reservation.companionId}/files`
          : `/api/drafts/${reservation.draftToken}/files`;

        try {
          await uploadWithProgress(
            endpoint,
            formData,
            (percent) => {
              setFiles((current) =>
                current.map((file) =>
                  file.id === item.id ? { ...file, progress: percent } : file,
                ),
              );
            },
            controller.signal,
          );
          setFiles((current) =>
            current.map((file) =>
              file.id === item.id ? { ...file, status: 'uploaded', progress: 100 } : file,
            ),
          );
        } catch (uploadError) {
          // One bad file must not lose the whole upload.
          const message =
            uploadError instanceof ApiError ? uploadError.message : 'Upload failed.';
          setFiles((current) =>
            current.map((file) =>
              file.id === item.id ? { ...file, status: 'error', error: message } : file,
            ),
          );
        }
      }

      // 3. An anonymous visitor now signs in; their draft is waiting for them.
      if (!authenticated) {
        const params = new URLSearchParams({ draft: reservation.draftToken as string });
        router.push(`/signup?${params.toString()}`);
        return;
      }

      // 4. Publish and start processing.
      setPhase('processing');
      await apiFetch(`/api/companions/${reservation.companionId}/publish`, { method: 'POST' });
      router.push(`/app/companions/${reservation.companionId}?created=1`);
    } catch (submitError) {
      setPhase('select');
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Something went wrong. Please try again.',
      );
    }
  }, [authenticated, name, router, usableFiles]);

  if (phase === 'processing') {
    return <ProcessingPanel step={progressStep} />;
  }

  return (
    <div className="space-y-5">
      <Dropzone
        files={files}
        onAdd={addFiles}
        onRemove={removeFile}
        disabled={phase !== 'select'}
        compact={compact}
        maxBytes={maxUploadBytes}
      />

      {files.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextInput
            label="Companion name"
            placeholder={usableFiles[0]?.file.name.replace(/\.[^.]+$/, '') ?? 'Untitled'}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={phase !== 'select'}
            className="sm:max-w-sm"
          />
          <Button
            onClick={attach}
            disabled={!canSubmit}
            loading={phase === 'uploading'}
            size="lg"
            className="sm:ml-auto"
            icon={phase === 'uploading' ? undefined : <AskGlyph size={15} />}
          >
            {phase === 'uploading' ? 'Uploading…' : 'Attach Companion'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[14px] bg-danger-soft px-4 py-3 text-[13.5px] text-danger"
        >
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {files.length > 0 && !authenticated ? (
        <p className="text-center text-[12.5px] text-ink-subtle">
          You will create an account after uploading. Your files stay exactly where they are.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The build screen. Five plain-language steps; no technical vocabulary reaches
 * the sender. Progress is polled so leaving the page and returning is safe.
 */
export function ProcessingPanel({
  step = 0,
  progress,
  error,
  fileName,
}: {
  step?: number;
  progress?: number;
  error?: string | null;
  fileName?: string | null;
}) {
  const activeStep =
    progress !== undefined
      ? Math.min(Math.floor((progress / 100) * PROCESSING_STEPS.length), PROCESSING_STEPS.length - 1)
      : step;

  return (
    <div className="card p-8">
      <h2 className="text-[19px] text-ink">Building your Companion</h2>
      <p className="mt-1.5 text-[13.5px] text-ink-muted">
        {error
          ? 'Something needs your attention.'
          : 'This usually takes less than a minute. You can leave this page — we will keep going.'}
      </p>

      <ol className="mt-7 space-y-3">
        {PROCESSING_STEPS.map((processingStep, index) => {
          const done = index < activeStep;
          const active = index === activeStep && !error;
          return (
            <li key={processingStep.key} className="flex items-center gap-3">
              <span
                className={clsx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-[560] tabular-nums transition-colors duration-200',
                  done
                    ? 'bg-success text-white'
                    : active
                      ? 'bg-accent text-white'
                      : 'bg-surface-sunken text-ink-subtle',
                )}
              >
                {done ? <CheckIcon size={13} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span
                className={clsx(
                  'text-[14px] transition-colors duration-200',
                  done || active ? 'text-ink' : 'text-ink-subtle',
                )}
              >
                {processingStep.label}
              </span>
              {active ? (
                <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-subtle">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                  Working
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="mt-6 rounded-[14px] bg-danger-soft px-4 py-3 text-[13.5px] text-danger">
          <p className="font-[520]">{fileName ? `${fileName} could not be processed` : 'Processing failed'}</p>
          <p className="mt-0.5 opacity-90">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export function HowItWorks({ className }: { className?: string }) {
  const steps = [
    { title: 'Drop anything', body: 'One file, a folder, several ZIPs, or any mix of them.' },
    { title: 'Attach Companion', body: 'We prepare everything and build one permanent link.' },
    { title: 'Share one link', body: 'Recipients read, ask questions, and never need an account.' },
  ];
  return (
    <ol className={clsx('grid gap-5 sm:grid-cols-3', className)}>
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-[560] tabular-nums text-ink-muted">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-[520] text-ink">{step.title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted text-pretty">
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export { ArrowRightIcon, formatBytes };
