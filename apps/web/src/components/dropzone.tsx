'use client';

import { DROPZONE_ACCEPT, extensionOf, formatBytes, isAcceptedFilename } from '@companion/shared';
import { clsx } from 'clsx';
import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { Button } from './ui/button';
import { FileIcon, CloseIcon, UploadIcon, PlusIcon } from './ui/icons';

/**
 * The single upload surface.
 *
 * There is exactly one dropzone in the product. It never asks what kind of
 * thing is being uploaded: one PDF, fourteen PDFs, a ZIP, several ZIPs, a
 * dropped folder or any mix all arrive the same way.
 */
export interface PendingFile {
  id: string;
  file: File;
  /** Path the browser reported for a dropped folder, e.g. "Security/policy.pdf". */
  relativePath: string;
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
  progress: number;
  error?: string;
}

export function Dropzone({
  files,
  onAdd,
  onRemove,
  disabled,
  compact = false,
  maxBytes,
}: {
  files: PendingFile[];
  onAdd: (files: PendingFile[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
  maxBytes?: number;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const accept = useCallback(
    (incoming: { file: File; relativePath: string }[]) => {
      const next: PendingFile[] = incoming.map((item, index) => {
        const supported = isAcceptedFilename(item.file.name);
        const tooLarge = maxBytes !== undefined && item.file.size > maxBytes;
        return {
          id: `${Date.now()}-${index}-${item.file.name}`,
          file: item.file,
          relativePath: item.relativePath,
          status: supported && !tooLarge ? 'ready' : 'error',
          progress: 0,
          ...(supported
            ? tooLarge
              ? { error: `Larger than the ${formatBytes(maxBytes)} limit` }
              : {}
            : { error: `.${extensionOf(item.file.name) || 'file'} is not supported` }),
        };
      });
      onAdd(next);
    },
    [maxBytes, onAdd],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;

      const items = event.dataTransfer.items;
      // The entries API is what makes dropping a whole folder work.
      if (items?.length && typeof items[0]?.webkitGetAsEntry === 'function') {
        const collected: { file: File; relativePath: string }[] = [];
        const entries = Array.from(items)
          .map((item) => item.webkitGetAsEntry())
          .filter((entry): entry is FileSystemEntry => entry !== null);
        await Promise.all(entries.map((entry) => walkEntry(entry, '', collected)));
        if (collected.length > 0) {
          accept(collected);
          return;
        }
      }

      const dropped = Array.from(event.dataTransfer.files).map((file) => ({
        file,
        relativePath: file.name,
      }));
      if (dropped.length > 0) accept(dropped);
    },
    [accept, disabled],
  );

  const readyCount = files.filter((file) => file.status !== 'error').length;
  const totalBytes = files
    .filter((file) => file.status !== 'error')
    .reduce((sum, file) => sum + file.file.size, 0);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          // Ignore drags that merely cross a child element's boundary.
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={handleDrop}
        className={clsx(
          'relative rounded-[22px] border-2 border-dashed bg-surface transition-colors duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
          dragging ? 'border-accent bg-accent-soft/60' : 'border-line hover:border-line-strong',
          disabled && 'pointer-events-none opacity-60',
          compact ? 'px-6 py-8' : 'px-6 py-12 sm:py-16',
        )}
      >
        <div className="flex flex-col items-center text-center">
          <div
            className={clsx(
              'mb-4 flex size-11 items-center justify-center rounded-[14px] transition-colors duration-200',
              dragging ? 'bg-accent text-white' : 'bg-accent-soft text-accent',
            )}
          >
            <UploadIcon size={20} />
          </div>

          <p className={clsx('font-[520] text-ink', compact ? 'text-[15px]' : 'text-[17px]')}>
            Drop files or folders here
          </p>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-ink-muted text-pretty">
            PDF, Word, PowerPoint, Excel, images, ZIPs — one file, several files, several ZIPs, or
            any mix of them.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size={compact ? 'sm' : 'md'}
              onClick={() => inputRef.current?.click()}
            >
              Choose files
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={compact ? 'sm' : 'md'}
              onClick={() => folderInputRef.current?.click()}
            >
              Choose a folder
            </Button>
          </div>
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={DROPZONE_ACCEPT}
          className="sr-only"
          aria-label="Choose files to share"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []).map((file) => ({
              file,
              relativePath: file.name,
            }));
            if (chosen.length > 0) accept(chosen);
            event.target.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // Non-standard but universally supported; enables folder selection.
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          className="sr-only"
          aria-label="Choose a folder to share"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []).map((file) => ({
              file,
              relativePath:
                (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
            }));
            if (chosen.length > 0) accept(chosen);
            event.target.value = '';
          }}
        />
      </div>

      {files.length > 0 ? (
        <div className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[13px] text-ink-muted">
              <span className="font-[520] text-ink">{readyCount}</span>{' '}
              {readyCount === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<PlusIcon size={15} />}
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
            >
              Add more
            </Button>
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto scrollbar-slim">
            {files.map((item) => (
              <FileRow key={item.id} item={item} onRemove={onRemove} disabled={disabled} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  item,
  onRemove,
  disabled,
}: {
  item: PendingFile;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const isError = item.status === 'error';
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        className={clsx(
          'flex size-8 shrink-0 items-center justify-center rounded-[9px]',
          isError ? 'bg-danger-soft text-danger' : 'bg-surface-sunken text-ink-muted',
        )}
      >
        <FileIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-ink">{item.relativePath}</p>
        <p className={clsx('text-[12px]', isError ? 'text-danger' : 'text-ink-subtle')}>
          {isError ? item.error : formatBytes(item.file.size)}
          {item.status === 'uploading' ? ` · ${Math.round(item.progress)}%` : ''}
          {item.status === 'uploaded' ? ' · Uploaded' : ''}
        </p>
        {item.status === 'uploading' ? (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        disabled={disabled}
        aria-label={`Remove ${item.relativePath}`}
        className="shrink-0 rounded-[8px] p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
      >
        <CloseIcon size={15} />
      </button>
    </li>
  );
}

/** Recursively collects files from a dropped directory tree. */
async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { file: File; relativePath: string }[],
  depth = 0,
): Promise<void> {
  // Guard against a pathological tree taking the tab down.
  if (depth > 12 || out.length > 2_000) return;

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) out.push({ file, relativePath: prefix ? `${prefix}/${file.name}` : file.name });
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    // readEntries returns at most 100 per call; keep reading until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, nextPrefix, out, depth + 1);
    }
  }
}
