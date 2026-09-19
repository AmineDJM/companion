'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { SearchIcon } from '../ui/icons';

interface SearchResult {
  kind: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global operator search across users, workspaces, Companions, share slugs and
 * Stripe identifiers — the fastest path from a support ticket to the record.
 */
export function AdminSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Debounced so typing a Stripe id does not fire a query per character.
    const timer = setTimeout(() => {
      apiFetch<{ results: SearchResult[] }>(
        `/api/admin/search?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      )
        .then((response) => {
          setResults(response.results);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative max-w-xl">
      <SearchIcon
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-admin-muted)]"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search users, workspaces, Companions, slugs, Stripe ids…  ⌘K"
        aria-label="Search the platform"
        className="h-9 w-full rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] pl-9 pr-3 text-[13px] text-[color:var(--color-admin-ink)] placeholder:text-[color:var(--color-admin-muted)]/70 focus:border-accent focus:outline-none"
      />

      {open && results.length > 0 ? (
        <ul className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-y-auto rounded-[12px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-surface)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)] scrollbar-slim">
          {results.map((result) => (
            <li key={`${result.kind}-${result.id}`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  router.push(result.href);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--color-admin-elevated)]"
              >
                <span className="rounded-[5px] bg-[color:var(--color-admin-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[color:var(--color-admin-muted)]">
                  {result.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[color:var(--color-admin-ink)]">
                    {result.title}
                  </span>
                  <span className="block truncate text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {result.subtitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
