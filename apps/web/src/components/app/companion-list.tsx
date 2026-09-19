'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { COMPANION_STATUSES, type AccessMode, type CompanionStatus } from '@companion/shared';
import { clsx } from 'clsx';
import { shareUrlDisplay } from '../../lib/share-url';
import { useClipboard } from '../../lib/use-clipboard';
import { StatusBadge } from '../ui/status';
import { Badge, Mono } from '../ui/primitives';
import { CheckIcon, CopyIcon, EyeOffIcon, DownloadIcon, LockIcon, SearchIcon } from '../ui/icons';

export interface CompanionListItem {
  id: string;
  name: string;
  slug: string;
  status: CompanionStatus;
  fileCount: number;
  viewCount: number;
  questionCount: number;
  unansweredCount: number;
  downloadAllowed: boolean;
  accessMode: AccessMode;
  expiresAt: string | null;
  expiresSoon: boolean;
  updatedLabel: string;
}

const PAGE_SIZE = 20;

export function CompanionList({
  items,
  total,
  filters,
  page,
}: {
  items: CompanionListItem[];
  total: number;
  filters: { q: string; status: string; sort: string };
  page: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);

  const update = useCallback(
    (next: Record<string, string>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) search.set(key, value);
        else search.delete(key);
      }
      // Any filter change resets pagination, or the result set looks empty.
      if (!('page' in next)) search.delete('page');
      startTransition(() => router.push(`/app/companions?${search.toString()}`));
    },
    [params, router],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="mt-7" aria-label="Your Companions">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: query });
          }}
          className="relative min-w-0 flex-1 sm:max-w-xs"
        >
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Companions"
            aria-label="Search Companions"
            className="h-9 w-full rounded-[11px] border border-line bg-surface pl-9 pr-3 text-[13.5px] text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/18"
          />
        </form>

        <select
          value={filters.status}
          onChange={(event) => update({ status: event.target.value })}
          aria-label="Filter by status"
          className="h-9 rounded-[11px] border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All statuses</option>
          {COMPANION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(event) => update({ sort: event.target.value })}
          aria-label="Sort Companions"
          className="h-9 rounded-[11px] border border-line bg-surface px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none"
        >
          <option value="updated">Last updated</option>
          <option value="created">Recently created</option>
          <option value="name">Name</option>
          <option value="views">Most viewed</option>
          <option value="questions">Most questions</option>
        </select>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-center text-[13.5px] text-ink-muted">
          No Companions match those filters.
        </p>
      ) : (
        <ul className={clsx('mt-4 space-y-2.5', pending && 'opacity-60')}>
          {items.map((item) => (
            <CompanionRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
            className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[13px] tabular-nums text-ink-muted">
            {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => update({ page: String(page + 1) })}
            className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function CompanionRow({ item }: { item: CompanionListItem }) {
  const { copied, copy } = useClipboard();
  const display = shareUrlDisplay(item.slug);

  return (
    <li className="card group px-5 py-4 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/app/companions/${item.id}`}
              className="truncate text-[15px] font-[520] text-ink transition-colors hover:text-accent"
            >
              {item.name}
            </Link>
            <StatusBadge status={item.status} />
            {item.expiresSoon ? (
              <Badge tone="warning">
                Expires soon
                <Link
                  href={`/app/companions/${item.id}/access`}
                  className="underline underline-offset-2"
                >
                  Extend
                </Link>
              </Badge>
            ) : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
            <button
              type="button"
              onClick={() => void copy(`${window.location.origin}/c/${item.slug}`)}
              aria-label={`Copy the link for ${item.name}`}
              className="flex items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 -ml-1.5 transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Mono>{display}</Mono>
              {copied ? (
                <CheckIcon size={13} className="text-success" />
              ) : (
                <CopyIcon size={13} className="opacity-60" />
              )}
            </button>
            <span>·</span>
            <span>
              {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'}
            </span>
            <span className="flex items-center gap-1">
              {item.downloadAllowed ? (
                <>
                  <DownloadIcon size={13} /> Downloadable
                </>
              ) : (
                <>
                  <EyeOffIcon size={13} /> View only
                </>
              )}
            </span>
            {item.accessMode !== 'PUBLIC' ? (
              <span className="flex items-center gap-1">
                <LockIcon size={13} />
                {item.accessMode === 'PASSWORD' ? 'Password' : 'Specific people'}
              </span>
            ) : null}
          </div>
        </div>

        <dl className="flex shrink-0 items-center gap-5 text-right">
          <Metric label="Views" value={item.viewCount} />
          <Metric label="Questions" value={item.questionCount} />
          <Metric
            label="Unanswered"
            value={item.unansweredCount}
            tone={item.unansweredCount > 0 ? 'warning' : 'default'}
          />
          <div className="hidden min-w-[5.5rem] text-right sm:block">
            <dt className="text-[11px] text-ink-subtle">Updated</dt>
            <dd className="text-[12.5px] text-ink-muted">{item.updatedLabel}</dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="min-w-[3.25rem]">
      <dt className="text-[11px] text-ink-subtle">{label}</dt>
      <dd
        className={clsx(
          'text-[16px] font-[520] tabular-nums',
          tone === 'warning' && value > 0 ? 'text-warning' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
