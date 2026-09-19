'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from './ui/icons';

export function UserMenu({
  name,
  email,
  isSuperAdmin,
  showBilling,
}: {
  name: string | null;
  email: string;
  isSuperAdmin: boolean;
  /** False when no Stripe key is configured; there is nothing to bill. */
  showBilling: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = (name ?? email).slice(0, 1).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-full p-0.5 transition-colors hover:bg-surface-sunken"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[12px] font-[560] text-accent">
          {initials}
        </span>
        <ChevronDownIcon size={14} className="text-ink-subtle" />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-fade-up absolute right-0 top-[calc(100%+6px)] w-56 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_8px_28px_rgba(21,22,26,0.1)]"
        >
          <div className="border-b border-line px-3.5 py-3">
            {name ? <p className="truncate text-[13.5px] font-[520] text-ink">{name}</p> : null}
            <p className="truncate text-[12.5px] text-ink-muted">{email}</p>
          </div>
          <div className="p-1">
            <MenuLink href="/app/companions">My Companions</MenuLink>
            <MenuLink href="/settings">Settings</MenuLink>
            {showBilling ? <MenuLink href="/billing">Billing</MenuLink> : null}
            {isSuperAdmin ? <MenuLink href="/admin">Admin console</MenuLink> : null}
          </div>
          <form action="/api/auth/logout" method="post" className="border-t border-line p-1">
            <button
              type="submit"
              role="menuitem"
              className="w-full rounded-[9px] px-2.5 py-2 text-left text-[13.5px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block rounded-[9px] px-2.5 py-2 text-[13.5px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {children}
    </Link>
  );
}
