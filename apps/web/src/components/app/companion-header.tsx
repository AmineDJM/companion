'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CompanionStatus } from '@companion/shared';
import { clsx } from 'clsx';
import { apiFetch } from '../../lib/api';
import { shareUrl, shareUrlDisplay } from '../../lib/share-url';
import { useClipboard } from '../../lib/use-clipboard';
import { Button } from '../ui/button';
import { Mono } from '../ui/primitives';
import { StatusBadge } from '../ui/status';
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
} from '../ui/icons';

const TABS = [
  { key: '', label: 'Overview' },
  { key: '/files', label: 'Files' },
  { key: '/analytics', label: 'Analytics' },
  { key: '/access', label: 'Access' },
] as const;

export function CompanionHeader({
  id,
  name,
  slug,
  status,
}: {
  id: string;
  name: string;
  slug: string;
  status: CompanionStatus;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { copied, copy } = useClipboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const base = `/app/companions/${id}`;
  const activeTab = TABS.slice().reverse().find((tab) => pathname.endsWith(tab.key) && tab.key) ?? TABS[0];

  const act = async (action: string) => {
    setBusy(true);
    setMenuOpen(false);
    try {
      await apiFetch(`${'/api/companions/'}${id}/lifecycle`, { method: 'POST', json: { action } });
      if (action === 'delete') router.push('/app/companions');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-[22px] tracking-[-0.025em] text-ink">{name}</h1>
            <StatusBadge status={status} />
          </div>

          <button
            type="button"
            onClick={() => void copy(shareUrl(slug))}
            className="mt-2 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-line-strong"
          >
            <Mono className="text-ink">{shareUrlDisplay(slug)}</Mono>
            {copied ? (
              <span className="flex items-center gap-1 text-[12px] text-success">
                <CheckIcon size={13} /> Copied
              </span>
            ) : (
              <CopyIcon size={14} className="text-ink-subtle" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<ExternalIcon size={15} />}
            onClick={() => window.open(`/c/${slug}`, '_blank', 'noopener')}
          >
            Preview
          </Button>

          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
              disabled={busy}
            >
              <MoreIcon size={16} />
            </Button>

            {menuOpen ? (
              <div
                role="menu"
                className="animate-fade-up absolute right-0 top-[calc(100%+6px)] z-20 w-52 overflow-hidden rounded-[13px] border border-line bg-surface p-1 shadow-[0_8px_28px_rgba(21,22,26,0.1)]"
              >
                {status === 'PAUSED' || status === 'REVOKED' || status === 'ARCHIVED' ? (
                  <MenuItem icon={<PlayIcon size={15} />} onClick={() => void act('reactivate')}>
                    Reactivate
                  </MenuItem>
                ) : (
                  <MenuItem icon={<PauseIcon size={15} />} onClick={() => void act('pause')}>
                    Pause access
                  </MenuItem>
                )}
                {status !== 'REVOKED' ? (
                  <MenuItem icon={<BanIcon size={15} />} onClick={() => void act('revoke')} danger>
                    Revoke access
                  </MenuItem>
                ) : null}
                {status !== 'ARCHIVED' ? (
                  <MenuItem onClick={() => void act('archive')}>Archive</MenuItem>
                ) : null}
                <MenuItem
                  icon={<TrashIcon size={15} />}
                  danger
                  onClick={() => {
                    if (
                      window.confirm(
                        'Delete this Companion? The link stops working immediately and the files are removed after a short retention period.',
                      )
                    ) {
                      void act('delete');
                    }
                  }}
                >
                  Delete
                </MenuItem>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <nav aria-label="Companion sections" className="mt-6 border-b border-line">
        <ul className="-mb-px flex gap-1">
          {TABS.map((tab) => {
            const href = `${base}${tab.key}`;
            const isActive = tab.key === activeTab.key;
            return (
              <li key={tab.key}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'inline-block border-b-2 px-3 py-2.5 text-[13.5px] transition-colors',
                    isActive
                      ? 'border-accent text-ink'
                      : 'border-transparent text-ink-muted hover:text-ink',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] transition-colors',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
