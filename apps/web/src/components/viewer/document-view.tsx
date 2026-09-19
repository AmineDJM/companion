'use client';

import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentKind } from '@companion/shared';
import { Spinner } from '../ui/button';
import { FileIcon } from '../ui/icons';

/**
 * The document surface.
 *
 * Pages are served as images through an authorising route, so a view-only
 * Companion never hands the browser the source file. Pages load lazily with the
 * next one prefetched, which is what keeps a 200-page deck feeling instant.
 */
export interface PreviewInfo {
  kind: 'page_images' | 'pdf' | 'sheets' | 'image' | 'text' | 'unavailable';
  pageCount: number;
  baseUrl: string;
  mimeType: string;
  /** Width / height of the first page, measured when it was rendered. */
  aspectRatio: number | null;
}

/**
 * How wide to draw a page at 100% zoom.
 *
 * A document has a natural reading size, and "as wide as the window" is not
 * it: an A4 page stretched across a 27-inch screen is a worse reading
 * experience than the paper it came from, while a 16:9 deck stretched to the
 * same width is exactly right. So the ceiling follows the shape of the page.
 *
 * Portrait pages settle near the width of a real sheet on a desk. Landscape
 * pages and slides are meant to be presented, so they take the room.
 */
function baseWidthFor(aspectRatio: number | null): number {
  if (aspectRatio === null) return 1_000;
  if (aspectRatio >= 1.2) return 1_680; // slides and landscape
  if (aspectRatio >= 0.95) return 1_200; // square-ish
  return 1_000; // A4, Letter, anything portrait
}

export function DocumentView({
  preview,
  fileName,
  fileKind,
  zoom,
  page,
  onPageChange,
  onVisiblePage,
  onSelection,
}: {
  preview: PreviewInfo | null;
  fileName: string;
  fileKind: DocumentKind;
  zoom: number;
  page: number;
  onPageChange: (page: number) => void;
  onVisiblePage: (page: number) => void;
  onSelection: (text: string, rect: DOMRect | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const [loaded, setLoaded] = useState<Set<number>>(new Set([1, 2]));

  const pages = useMemo(
    () => Array.from({ length: preview?.pageCount ?? 0 }, (_, index) => index + 1),
    [preview?.pageCount],
  );

  // Load pages as they approach the viewport, and prefetch the next one so
  // scrolling never waits on a network round trip.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const value = Number((entry.target as HTMLElement).dataset['page']);
          if (!Number.isFinite(value)) continue;
          if (entry.isIntersecting) {
            setLoaded((current) => {
              if (current.has(value) && current.has(value + 1)) return current;
              const next = new Set(current);
              next.add(value);
              next.add(value + 1);
              return next;
            });
            if (entry.intersectionRatio > 0.45) onVisiblePage(value);
          }
        }
      },
      { root, rootMargin: '800px 0px', threshold: [0, 0.45] },
    );

    for (const element of pageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [pages.length, onVisiblePage]);

  // Jumping to a citation scrolls the target page into view.
  useEffect(() => {
    const element = pageRefs.current.get(page);
    if (!element) return;
    setLoaded((current) => {
      const next = new Set(current);
      next.add(page);
      next.add(page + 1);
      return next;
    });
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (text.length < 12) {
      onSelection('', null);
      return;
    }
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    onSelection(text.slice(0, 2_000), range?.getBoundingClientRect() ?? null);
  }, [onSelection]);

  if (!preview || preview.kind === 'unavailable') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <FileIcon size={28} className="mx-auto text-ink-subtle" />
          <p className="mt-3 text-[14px] text-ink">{fileName}</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            A preview of this file is not available.
          </p>
        </div>
      </div>
    );
  }

  if (preview.kind === 'sheets') {
    return <SheetView baseUrl={preview.baseUrl} fileName={fileName} />;
  }

  if (preview.kind === 'text') {
    return <TextView baseUrl={preview.baseUrl} onSelection={handleMouseUp} />;
  }

  if (preview.kind === 'pdf') {
    // Fallback path when page images are unavailable: the PDF is still streamed
    // through the authorising route, never from a storage URL.
    return (
      <object
        data={`${preview.baseUrl}/preview#toolbar=0&navpanes=0`}
        type="application/pdf"
        className="h-full w-full"
        aria-label={fileName}
      >
        <p className="p-8 text-[13.5px] text-ink-muted">
          This document cannot be displayed in your browser.
        </p>
      </object>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className="h-full overflow-y-auto scrollbar-slim bg-[#ECECEF] px-3 py-5 sm:px-6 sm:py-8"
    >
      <div
        className="mx-auto flex flex-col items-center gap-4"
        style={{
          // A pixel ceiling rather than a percentage: a percentage of a very
          // wide window upscales the page past the resolution it was rendered
          // at, which reads as blur rather than as size. Zoom still scales
          // from here, so the control does what the reader expects.
          width: `${Math.round(baseWidthFor(preview.aspectRatio) * (zoom / 100))}px`,
          maxWidth: '100%',
        }}
      >
        {pages.map((pageNumber) => (
          <figure
            key={pageNumber}
            data-page={pageNumber}
            ref={(element) => {
              if (element) pageRefs.current.set(pageNumber, element);
              else pageRefs.current.delete(pageNumber);
            }}
            className="w-full overflow-hidden rounded-[6px] bg-white shadow-[0_1px_3px_rgba(21,22,26,0.12),0_6px_18px_rgba(21,22,26,0.08)]"
          >
            {loaded.has(pageNumber) ? (
              <img
                src={`${preview.baseUrl}/page/${pageNumber}`}
                alt={
                  preview.pageCount > 1
                    ? `${fileName}, page ${pageNumber} of ${preview.pageCount}`
                    : fileName
                }
                loading={pageNumber <= 2 ? 'eager' : 'lazy'}
                decoding="async"
                className="block h-auto w-full"
                onLoad={() => {
                  if (pageNumber === 1) onPageChange(1);
                }}
              />
            ) : (
              <div
                className="flex w-full items-center justify-center"
                // The real shape, so a deck does not reserve the space of an
                // A4 page and visibly jump the moment it loads.
                style={{ aspectRatio: preview.aspectRatio ?? 1 / 1.414 }}
              >
                <Spinner className="text-ink-subtle" />
              </div>
            )}
          </figure>
        ))}
      </div>
      {fileKind === 'IMAGE' && pages.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-muted">No preview available.</p>
      ) : null}
    </div>
  );
}

interface SheetModel {
  sheets: { name: string; columns: string[]; rows: (string | number | null)[][]; truncated: boolean }[];
}

/** Spreadsheets render as a readable table rather than a converted page image. */
function SheetView({ baseUrl, fileName }: { baseUrl: string; fileName: string }) {
  const [model, setModel] = useState<SheetModel | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${baseUrl}/preview`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((data: SheetModel) => {
        if (!cancelled) setModel(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  if (error) {
    return <p className="p-8 text-center text-[13.5px] text-ink-muted">This sheet could not be displayed.</p>;
  }
  if (!model) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-ink-subtle" />
      </div>
    );
  }

  const sheet = model.sheets[active];

  return (
    <div className="flex h-full flex-col bg-surface">
      {model.sheets.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 scrollbar-slim">
          {model.sheets.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setActive(index)}
              className={clsx(
                'shrink-0 rounded-[8px] px-2.5 py-1 text-[12.5px] transition-colors',
                index === active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-sunken',
              )}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto scrollbar-slim">
        <table className="w-full border-collapse text-[12.5px]">
          <caption className="sr-only">{`${fileName}${sheet ? ` — ${sheet.name}` : ''}`}</caption>
          {sheet?.columns.length ? (
            <thead className="sticky top-0 z-10 bg-surface-sunken">
              <tr>
                <th className="w-10 border border-line px-2 py-1.5 text-right font-[500] text-ink-subtle">
                  #
                </th>
                {sheet.columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="border border-line px-2.5 py-1.5 text-left font-[520] text-ink"
                  >
                    {column || ' '}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {(sheet?.rows ?? []).slice(1).map((row, rowIndex) => (
              <tr key={rowIndex} className="even:bg-canvas/60">
                <th
                  scope="row"
                  className="border border-line px-2 py-1.5 text-right font-normal tabular-nums text-ink-subtle"
                >
                  {rowIndex + 2}
                </th>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={clsx(
                      'border border-line px-2.5 py-1.5 text-ink',
                      typeof cell === 'number' && 'text-right tabular-nums',
                    )}
                  >
                    {cell === null ? '' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet?.truncated ? (
          <p className="px-4 py-3 text-[12px] text-ink-subtle">
            Showing the first rows of this sheet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TextView({ baseUrl, onSelection }: { baseUrl: string; onSelection: () => void }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${baseUrl}/preview`)
      .then((response) => response.text())
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch(() => {
        if (!cancelled) setText('');
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  if (text === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-ink-subtle" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-slim bg-[#ECECEF] px-4 py-8">
      <article
        onMouseUp={onSelection}
        className="mx-auto max-w-3xl whitespace-pre-wrap rounded-[8px] bg-white p-8 text-[14px] leading-[1.75] text-ink shadow-[0_1px_3px_rgba(21,22,26,0.1)]"
      >
        {text}
      </article>
    </div>
  );
}
