'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { formatBytes, formatRelativeTime, type DocumentKind, type FileStatus } from '@companion/shared';
import { clsx } from 'clsx';
import { ApiError, apiFetch, uploadWithProgress } from '../../lib/api';
import { Button } from '../ui/button';
import { Badge, Card, SectionHeading } from '../ui/primitives';
import { Dropzone, type PendingFile } from '../dropzone';
import {
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  RefreshIcon,
  TrashIcon,
} from '../ui/icons';

export interface ManagedVersion {
  version: number;
  createdAt: string;
  sizeBytes: number;
  filename: string;
  current: boolean;
}

export interface ManagedFile {
  id: string;
  name: string;
  path: string;
  kind: DocumentKind;
  status: FileStatus;
  statusMessage: string | null;
  sizeBytes: number;
  pageCount: number | null;
  isContainer: boolean;
  versionCount: number;
  versions: ManagedVersion[];
}

export function FileManager({
  companionId,
  defaultFileId,
  canReplace,
  files,
}: {
  companionId: string;
  defaultFileId: string | null;
  canReplace: boolean;
  files: ManagedFile[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const addFiles = useCallback(async () => {
    const usable = pending.filter((file) => file.status !== 'error');
    if (usable.length === 0) return;
    setBusy(true);
    setError(null);

    for (const item of usable) {
      setPending((current) =>
        current.map((file) =>
          file.id === item.id ? { ...file, status: 'uploading', progress: 0 } : file,
        ),
      );
      const form = new FormData();
      form.append('file', item.file, item.file.name);
      form.append('relativePath', item.relativePath);
      try {
        await uploadWithProgress(`/api/companions/${companionId}/files`, form, (percent) => {
          setPending((current) =>
            current.map((file) => (file.id === item.id ? { ...file, progress: percent } : file)),
          );
        });
        setPending((current) => current.filter((file) => file.id !== item.id));
      } catch (uploadError) {
        const message = uploadError instanceof ApiError ? uploadError.message : 'Upload failed.';
        setPending((current) =>
          current.map((file) =>
            file.id === item.id ? { ...file, status: 'error', error: message } : file,
          ),
        );
      }
    }

    setBusy(false);
    router.refresh();
  }, [companionId, pending, router]);

  const replaceFile = useCallback(
    async (fileId: string, file: File) => {
      setBusy(true);
      setError(null);
      const form = new FormData();
      form.append('file', file, file.name);
      try {
        await uploadWithProgress(`/api/companions/${companionId}/files/${fileId}`, form, () => {});
        router.refresh();
      } catch (replaceError) {
        setError(
          replaceError instanceof ApiError ? replaceError.message : 'Could not replace the file.',
        );
      } finally {
        setBusy(false);
      }
    },
    [companionId, router],
  );

  const removeFile = useCallback(
    async (fileId: string, name: string) => {
      if (!window.confirm(`Remove ${name}? The share link stays the same.`)) return;
      setBusy(true);
      try {
        await apiFetch(`/api/companions/${companionId}/files/${fileId}`, { method: 'DELETE' });
        router.refresh();
      } catch (removeError) {
        setError(removeError instanceof ApiError ? removeError.message : 'Could not remove the file.');
      } finally {
        setBusy(false);
      }
    },
    [companionId, router],
  );

  const setDefault = useCallback(
    async (fileId: string) => {
      setBusy(true);
      try {
        await apiFetch(`/api/companions/${companionId}`, {
          method: 'PATCH',
          json: { defaultFileId: fileId },
        });
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [companionId, router],
  );

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          title="Files"
          description="Replacing a document keeps the same link. Recipients see the new version immediately."
        />
        <ul className="mt-5 divide-y divide-line">
          {files.map((file) => (
            <li key={file.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={clsx(
                    'flex size-9 shrink-0 items-center justify-center rounded-[10px]',
                    file.status === 'FAILED' || file.status === 'UNSUPPORTED'
                      ? 'bg-danger-soft text-danger'
                      : 'bg-surface-sunken text-ink-muted',
                  )}
                >
                  {file.isContainer ? <FolderIcon size={17} /> : <FileIcon size={17} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] text-ink">{file.path}</span>
                    {file.id === defaultFileId ? <Badge tone="accent">Opens first</Badge> : null}
                    {file.isContainer ? <Badge>Archive</Badge> : null}
                    <FileStatusBadge status={file.status} />
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-subtle">
                    {formatBytes(file.sizeBytes)}
                    {file.pageCount ? ` · ${file.pageCount} pages` : ''}
                    {file.versionCount > 1 ? ` · version ${file.versionCount}` : ''}
                    {file.statusMessage ? ` · ${file.statusMessage}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!file.isContainer && file.status === 'READY' && file.id !== defaultFileId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void setDefault(file.id)}
                    >
                      Open first
                    </Button>
                  ) : null}

                  {!file.isContainer ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !canReplace}
                      title={
                        canReplace
                          ? 'Replace this document'
                          : 'Replacing documents is available on the Pro plan'
                      }
                      icon={<RefreshIcon size={15} />}
                      onClick={() => {
                        replaceTarget.current = file.id;
                        replaceInput.current?.click();
                      }}
                    >
                      Replace
                    </Button>
                  ) : null}

                  {file.versions.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded === file.id}
                      onClick={() => setExpanded(expanded === file.id ? null : file.id)}
                      icon={<ChevronDownIcon size={15} />}
                    >
                      History
                    </Button>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${file.name}`}
                    onClick={() => void removeFile(file.id, file.name)}
                  >
                    <TrashIcon size={15} />
                  </Button>
                </div>
              </div>

              {expanded === file.id && file.versions.length > 0 ? (
                <ul className="mt-3 space-y-1.5 rounded-[12px] bg-canvas px-4 py-3">
                  {file.versions.map((version) => (
                    <li
                      key={version.version}
                      className="flex items-center justify-between gap-3 text-[12.5px]"
                    >
                      <span className="text-ink">
                        Version {version.version}
                        {version.current ? (
                          <span className="ml-2 text-success">
                            <CheckIcon size={12} className="inline" /> current
                          </span>
                        ) : null}
                      </span>
                      <span className="text-ink-subtle">
                        {formatBytes(version.sizeBytes)} · {formatRelativeTime(version.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        <input
          ref={replaceInput}
          type="file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            const target = replaceTarget.current;
            if (file && target) void replaceFile(target, file);
            event.target.value = '';
            replaceTarget.current = null;
          }}
        />
      </Card>

      <Card>
        <SectionHeading title="Add more files" description="They join this Companion under the same link." />
        <div className="mt-5">
          <Dropzone
            files={pending}
            onAdd={(incoming) => setPending((current) => [...current, ...incoming])}
            onRemove={(fileId) => setPending((current) => current.filter((file) => file.id !== fileId))}
            disabled={busy}
            compact
          />
        </div>
        {pending.length > 0 ? (
          <Button onClick={addFiles} loading={busy} className="mt-4">
            Add {pending.filter((file) => file.status !== 'error').length} to this Companion
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function FileStatusBadge({ status }: { status: FileStatus }) {
  if (status === 'READY') return null;
  if (status === 'FAILED') return <Badge tone="danger">Could not be read</Badge>;
  if (status === 'UNSUPPORTED') return <Badge tone="danger">Unsupported</Badge>;
  if (status === 'REMOVED') return <Badge>Removed</Badge>;
  return <Badge tone="accent">Preparing</Badge>;
}
