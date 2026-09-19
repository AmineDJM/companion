'use client';

import { formatBytes } from '@companion/shared';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef } from 'react';
import type { ViewerFile } from './types';
import { CloseIcon, FileIcon, FolderIcon } from '../ui/icons';

/**
 * The file drawer.
 *
 * Not a "data room homepage": the recipient already has a document open, and
 * this is how they reach the others. Folder structure from an uploaded ZIP is
 * preserved so the bundle reads the way the sender assembled it.
 */
interface TreeNode {
  type: 'folder' | 'file';
  name: string;
  path: string;
  depth: number;
  file?: ViewerFile;
}

export function FileDrawer({
  files,
  activeFileId,
  open,
  onClose,
  onSelect,
}: {
  files: ViewerFile[];
  activeFileId: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (fileId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(files), [files]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    // Deferred so the click that opened the drawer does not immediately close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/15 lg:hidden" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Files in this Companion"
        className="animate-fade-in fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-surface shadow-[8px_0_28px_rgba(21,22,26,0.1)]"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-[520] text-ink">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close file list"
            className="rounded-[8px] p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto p-2 scrollbar-slim">
          <ul>
            {tree.map((node) =>
              node.type === 'folder' ? (
                <li
                  key={`folder-${node.path}`}
                  className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] font-[520] text-ink-muted"
                  style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                >
                  <FolderIcon size={15} className="shrink-0 text-ink-subtle" />
                  <span className="truncate">{node.name}</span>
                </li>
              ) : (
                <li key={node.file?.id}>
                  <button
                    type="button"
                    disabled={!node.file?.ready}
                    onClick={() => node.file && onSelect(node.file.id)}
                    aria-current={node.file?.id === activeFileId ? 'true' : undefined}
                    style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-[9px] py-1.5 pr-2 text-left transition-colors',
                      node.file?.id === activeFileId
                        ? 'bg-accent-soft text-accent'
                        : 'text-ink hover:bg-surface-sunken',
                      !node.file?.ready && 'cursor-default opacity-55',
                    )}
                  >
                    <FileIcon size={15} className="shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{node.name}</span>
                      <span className="block text-[11.5px] text-ink-subtle">
                        {node.file?.ready
                          ? formatBytes(node.file.sizeBytes)
                          : (node.file?.statusMessage ?? 'Preparing…')}
                      </span>
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </nav>
      </div>
    </>
  );
}

/** Flattens files into a rendered tree, inferring folders from their paths. */
function buildTree(files: ViewerFile[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  const seenFolders = new Set<string>();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  for (const file of sorted) {
    const segments = file.path.split('/').filter(Boolean);
    const folders = segments.slice(0, -1);

    let accumulated = '';
    for (const [index, folder] of folders.entries()) {
      accumulated = accumulated ? `${accumulated}/${folder}` : folder;
      if (seenFolders.has(accumulated)) continue;
      seenFolders.add(accumulated);
      nodes.push({ type: 'folder', name: folder, path: accumulated, depth: index });
    }

    nodes.push({
      type: 'file',
      name: file.name,
      path: file.path,
      depth: folders.length,
      file,
    });
  }

  return nodes;
}
