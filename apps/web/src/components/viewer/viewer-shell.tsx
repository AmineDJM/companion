'use client';

import { formatDateShort } from '@companion/shared';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { AskBar, ChatPanel, type ChatMessage, type Citation } from './ask-panel';
import { DocumentView } from './document-view';
import { FileDrawer } from './file-drawer';
import type { ViewerData, ViewerFile, ViewerPreview } from './types';
import { CompanionMark } from '../ui/logo';
import {
  DownloadIcon,
  EyeOffIcon,
  ClockIcon,
  MenuIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../ui/icons';

/**
 * The recipient experience.
 *
 * Document first, Companion always available, nothing else. No marketing
 * navigation, no account prompt, no product framing — the reader opened a
 * document, and the document happens to be intelligent.
 */
export function ViewerShell({ initial }: { initial: ViewerData }) {
  const [activeFileId, setActiveFileId] = useState(initial.activeFileId);
  const [preview, setPreview] = useState<ViewerPreview | null>(initial.preview);
  const [page, setPage] = useState(1);
  const [visiblePage, setVisiblePage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const dwellRef = useRef<{ page: number; since: number }>({ page: 1, since: Date.now() });

  const activeFile = initial.files.find((file) => file.id === activeFileId) ?? null;

  const track = useCallback(
    (payload: Record<string, unknown>) => {
      // Analytics must never interrupt reading, so failures are swallowed.
      void apiFetch(`/api/c/${initial.slug}/events`, { method: 'POST', json: payload }).catch(
        () => undefined,
      );
    },
    [initial.slug],
  );

  useEffect(() => {
    track({ type: 'companion_opened' });
  }, [track]);

  // Report dwell time per page so the sender learns which pages mattered.
  const flushDwell = useCallback(() => {
    const elapsed = Date.now() - dwellRef.current.since;
    if (elapsed > 1_500 && activeFileId) {
      track({
        type: 'page_viewed',
        fileId: activeFileId,
        page: dwellRef.current.page,
        durationMs: Math.min(elapsed, 30 * 60 * 1000),
      });
    }
  }, [activeFileId, track]);

  useEffect(() => {
    const onHide = () => flushDwell();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flushDwell();
    };
  }, [flushDwell]);

  const handleVisiblePage = useCallback(
    (next: number) => {
      if (next === dwellRef.current.page) return;
      flushDwell();
      dwellRef.current = { page: next, since: Date.now() };
      setVisiblePage(next);
    },
    [flushDwell],
  );

  const openFile = useCallback(
    async (fileId: string, targetPage?: number) => {
      if (fileId === activeFileId) {
        if (targetPage) setPage(targetPage);
        setDrawerOpen(false);
        return;
      }
      flushDwell();
      setDrawerOpen(false);
      setActiveFileId(fileId);
      setPreview(null);
      setPage(targetPage ?? 1);
      dwellRef.current = { page: targetPage ?? 1, since: Date.now() };

      try {
        const response = await apiFetch<{ preview: ViewerPreview | null }>(
          `/api/c/${initial.slug}/files/${fileId}/describe`,
        );
        setPreview(response.preview);
      } catch {
        setPreview(null);
      }
      track({ type: 'file_opened', fileId });
    },
    [activeFileId, flushDwell, initial.slug, track],
  );

  const handleCitation = useCallback(
    (citation: Citation) => {
      track({ type: 'citation_opened', fileId: citation.fileId, page: citation.page ?? null });
      void openFile(citation.fileId, citation.page ?? 1);
    },
    [openFile, track],
  );

  const expiresLabel = initial.expiresAt ? formatDateShort(initial.expiresAt) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <header className="z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5 sm:px-4">
        {initial.multiFile ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Show all ${initial.files.length} files`}
            className="flex shrink-0 items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[12.5px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <MenuIcon size={16} />
            <span className="tabular-nums">{initial.files.length}</span>
            <span className="hidden sm:inline">files</span>
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13.5px] font-[500] text-ink">
            {activeFile?.name ?? initial.name}
          </h1>
          <p className="truncate text-[11.5px] text-ink-subtle">Shared by {initial.senderLabel}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!initial.downloadAllowed ? (
            <span className="hidden items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11.5px] text-ink-subtle sm:flex">
              <EyeOffIcon size={14} />
              View only
            </span>
          ) : null}

          {expiresLabel ? (
            <span className="hidden items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11.5px] text-ink-subtle md:flex">
              <ClockIcon size={14} />
              Expires {expiresLabel}
            </span>
          ) : null}

          {preview?.kind === 'page_images' ? (
            <div className="hidden items-center sm:flex">
              <IconButton
                label="Zoom out"
                onClick={() => setZoom((value) => Math.max(60, value - 15))}
                disabled={zoom <= 60}
              >
                <ZoomOutIcon size={15} />
              </IconButton>
              <span className="w-10 text-center text-[11.5px] tabular-nums text-ink-subtle">
                {zoom}%
              </span>
              <IconButton
                label="Zoom in"
                onClick={() => setZoom((value) => Math.min(180, value + 15))}
                disabled={zoom >= 180}
              >
                <ZoomInIcon size={15} />
              </IconButton>
            </div>
          ) : null}

          {initial.downloadAllowed && activeFileId ? (
            <a
              href={`/api/c/${initial.slug}/files/${activeFileId}/download`}
              onClick={() => track({ type: 'download_clicked', fileId: activeFileId })}
              aria-label="Download this document"
              className="flex size-8 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <DownloadIcon size={16} />
            </a>
          ) : null}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <FileDrawer
          files={initial.files}
          activeFileId={activeFileId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelect={(fileId) => void openFile(fileId)}
        />

        <div className="relative min-w-0 flex-1">
          <DocumentView
            preview={preview}
            fileName={activeFile?.name ?? initial.name}
            fileKind={activeFile?.kind ?? 'UNKNOWN'}
            zoom={zoom}
            page={page}
            onPageChange={setPage}
            onVisiblePage={handleVisiblePage}
            onSelection={(text) => setSelection(text || null)}
          />

          {preview && preview.pageCount > 1 ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
              <span className="rounded-full bg-ink/70 px-2.5 py-1 text-[11.5px] tabular-nums text-white backdrop-blur-sm">
                {visiblePage} / {preview.pageCount}
              </span>
            </div>
          ) : null}

          {initial.aiEnabled ? (
            <AskBar
              slug={initial.slug}
              multiFile={initial.multiFile}
              context={{
                fileId: activeFileId,
                page: visiblePage,
                sheet: null,
                selection,
              }}
              open={chatOpen}
              onOpenChange={setChatOpen}
              messages={messages}
              onMessages={setMessages}
              onCitation={handleCitation}
              selection={selection}
              onClearSelection={() => setSelection(null)}
            />
          ) : null}

          {initial.branding.showCompanionBranding ? (
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'absolute bottom-2 right-3 z-20 hidden items-center gap-1 text-[10.5px] text-ink-subtle/70 transition-colors hover:text-ink-muted lg:flex',
                chatOpen && 'lg:hidden',
              )}
            >
              <CompanionMark size={11} />
              Powered by Companion
            </a>
          ) : null}
        </div>

        <ChatPanel
          messages={messages}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onCitation={handleCitation}
        />
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-[8px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export type { ViewerData, ViewerFile };
