'use client';

import { ASK_PLACEHOLDER_MULTI, ASK_PLACEHOLDER_SINGLE } from '@companion/shared';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import { Spinner } from '../ui/button';
import { AskGlyph } from '../ui/logo';
import { CloseIcon, SendIcon } from '../ui/icons';

/**
 * The Ask experience.
 *
 * One discreet input at the bottom of the document, and a narrow panel that
 * opens beside it. The document never goes away and is never covered on
 * desktop — the reader is looking at their document, which happens to answer.
 */
export interface Citation {
  id: string;
  fileId: string;
  fileName: string;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  range: string | null;
  quote: string | null;
  label: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  answered?: boolean;
  pending?: boolean;
}

export interface AskContext {
  fileId: string | null;
  page: number | null;
  sheet: string | null;
  selection: string | null;
}

export function AskBar({
  slug,
  multiFile,
  context,
  open,
  onOpenChange,
  messages,
  onMessages,
  onCitation,
  selection,
  onClearSelection,
}: {
  slug: string;
  multiFile: boolean;
  context: AskContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessage[];
  onMessages: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  onCitation: (citation: Citation) => void;
  selection: string | null;
  onClearSelection: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      const pendingId = `pending-${Date.now()}`;
      onMessages((current) => [
        ...current,
        { id: `q-${Date.now()}`, role: 'user', text: trimmed },
        { id: pendingId, role: 'assistant', text: '', pending: true },
      ]);
      setValue('');
      setBusy(true);
      onOpenChange(true);

      try {
        const response = await apiFetch<{
          conversationId: string;
          answer: string;
          answered: boolean;
          citations: Citation[];
        }>(`/api/c/${slug}/ask`, {
          method: 'POST',
          json: {
            question: trimmed,
            conversationId: conversationRef.current,
            context: {
              fileId: context.fileId,
              page: context.page,
              sheet: context.sheet,
              selection: selection ?? null,
            },
          },
        });

        conversationRef.current = response.conversationId;
        onMessages((current) =>
          current.map((message) =>
            message.id === pendingId
              ? {
                  id: pendingId,
                  role: 'assistant',
                  text: response.answer,
                  citations: response.citations,
                  answered: response.answered,
                }
              : message,
          ),
        );
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : 'Something went wrong. Please try again.';
        onMessages((current) =>
          current.map((entry) =>
            entry.id === pendingId
              ? { id: pendingId, role: 'assistant', text: message, answered: false }
              : entry,
          ),
        );
      } finally {
        setBusy(false);
        onClearSelection();
      }
    },
    [busy, context, onClearSelection, onMessages, onOpenChange, selection, slug],
  );

  // Cmd/Ctrl+K focuses the Ask bar from anywhere in the viewer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={clsx(
        'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5',
        open && 'lg:pr-[calc(min(30rem,38vw)+1.5rem)]',
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(value);
        }}
        className="pointer-events-auto w-full max-w-2xl"
      >
        {selection ? (
          <div className="mb-2 flex items-start gap-2 rounded-[12px] border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] text-accent shadow-[0_2px_8px_rgba(21,22,26,0.06)]">
            <AskGlyph size={13} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2 flex-1">{selection}</span>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Clear the selected text"
              className="shrink-0 rounded p-0.5 hover:bg-accent-line/50"
            >
              <CloseIcon size={13} />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-[16px] border border-line bg-surface/95 p-1.5 shadow-[0_6px_24px_rgba(21,22,26,0.1)] backdrop-blur-xl transition-colors focus-within:border-accent-line">
          <span className="pointer-events-none pb-2 pl-2.5 text-accent">
            <AskGlyph size={15} />
          </span>
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit(value);
              }
            }}
            rows={1}
            placeholder={multiFile ? ASK_PLACEHOLDER_MULTI : ASK_PLACEHOLDER_SINGLE}
            aria-label={multiFile ? 'Ask anything across these files' : 'Ask anything'}
            className="max-h-32 min-h-[1.75rem] flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="submit"
            disabled={!value.trim() || busy}
            aria-label="Send question"
            className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-[11px] bg-accent text-white transition-colors hover:bg-accent-hover disabled:bg-line-strong"
          >
            {busy ? <Spinner /> : <SendIcon size={15} />}
          </button>
        </div>

        {messages.length === 0 && !open ? (
          <p className="mt-2 text-center text-[11.5px] text-ink-subtle">
            Answers come from this document and cite the exact page.
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** The chat panel. Narrow by design: the document keeps the screen. */
export function ChatPanel({
  messages,
  open,
  onClose,
  onCitation,
}: {
  messages: ChatMessage[];
  open: boolean;
  onClose: () => void;
  onCitation: (citation: Citation) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      aria-label="Answers"
      className={clsx(
        'z-40 flex flex-col border-line bg-surface',
        // Desktop: a panel beside the document. Mobile: a bottom sheet that
        // still leaves the document visible above it.
        'fixed inset-x-0 bottom-0 h-[72dvh] rounded-t-[20px] border-t shadow-[0_-8px_28px_rgba(21,22,26,0.14)]',
        'lg:static lg:h-auto lg:w-[min(30rem,38vw)] lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none',
      )}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <AskGlyph size={14} className="text-accent" />
          <h2 className="text-[13.5px] font-[520] text-ink">Answers</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close answers"
          className="rounded-[8px] p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-4 scrollbar-slim pb-28 lg:pb-24"
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onCitation={onCitation} />
        ))}
      </div>
    </aside>
  );
}

function MessageBubble({
  message,
  onCitation,
}: {
  message: ChatMessage;
  onCitation: (citation: Citation) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[14px] rounded-br-[5px] bg-accent-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
          {message.text}
        </p>
      </div>
    );
  }

  if (message.pending) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-muted" aria-live="polite">
        <Spinner className="text-accent" />
        Reading the document…
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div
        className={clsx(
          'whitespace-pre-wrap text-[13.5px] leading-[1.65]',
          message.answered === false ? 'text-ink-muted' : 'text-ink',
        )}
      >
        {message.text}
      </div>

      {message.citations && message.citations.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {message.citations.map((citation) => (
            <li key={citation.id}>
              <button
                type="button"
                onClick={() => onCitation(citation)}
                className="group flex w-full items-start gap-2 rounded-[10px] border border-line px-2.5 py-2 text-left transition-colors hover:border-accent-line hover:bg-accent-soft/50"
              >
                <span className="mt-[3px] size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-[500] text-ink group-hover:text-accent">
                    {citation.label}
                  </span>
                  {citation.quote ? (
                    <span className="mt-0.5 block line-clamp-2 text-[12px] leading-snug text-ink-muted">
                      “{citation.quote}”
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
