import Link from 'next/link';
import { clsx } from 'clsx';
import { CompanionMark } from '../ui/logo';

/**
 * The admin console is visually distinct from the customer product: a dark
 * operational surface, denser, built to be worked in rather than admired.
 */
const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard' }],
  },
  {
    group: 'Customers',
    items: [
      { href: '/admin/customers', label: 'Workspaces' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/companions', label: 'Companions' },
    ],
  },
  {
    group: 'Revenue',
    items: [
      { href: '/admin/revenue', label: 'Subscriptions' },
      { href: '/admin/payments', label: 'Payments' },
      { href: '/admin/plans', label: 'Plans & pricing' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { href: '/admin/usage', label: 'Usage & costs' },
      { href: '/admin/providers', label: 'AI & providers' },
      { href: '/admin/storage', label: 'Storage' },
      { href: '/admin/jobs', label: 'Jobs' },
    ],
  },
  {
    group: 'Platform',
    items: [
      { href: '/admin/flags', label: 'Feature flags' },
      { href: '/admin/limits', label: 'Limits' },
      { href: '/admin/system', label: 'System' },
      { href: '/admin/audit', label: 'Audit log' },
    ],
  },
];

export function AdminShell({
  children,
  pathname,
  adminEmail,
}: {
  children: React.ReactNode;
  pathname: string;
  adminEmail: string;
}) {
  return (
    <div className="admin-root flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[color:var(--admin-line)] bg-[color:var(--color-admin-surface)] lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-[color:var(--admin-line)] px-4">
          <CompanionMark size={20} />
          <span className="text-[13px] font-[560] tracking-[-0.01em] text-[color:var(--color-admin-ink)]">
            Companion
          </span>
          <span className="ml-auto rounded-[5px] bg-accent/20 px-1.5 py-0.5 text-[10px] font-[560] uppercase tracking-wider text-accent">
            Ops
          </span>
        </div>

        <nav aria-label="Admin" className="flex-1 overflow-y-auto px-2 py-3 scrollbar-slim">
          {NAV.map((section) => (
            <div key={section.group} className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-[560] uppercase tracking-[0.13em] text-[color:var(--color-admin-muted)]/70">
                {section.group}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'block rounded-[8px] px-2 py-1.5 text-[13px] transition-colors',
                          active
                            ? 'bg-[color:var(--color-admin-elevated)] text-[color:var(--color-admin-ink)]'
                            : 'text-[color:var(--color-admin-muted)] hover:bg-[color:var(--color-admin-elevated)]/60 hover:text-[color:var(--color-admin-ink)]',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-[color:var(--admin-line)] px-4 py-3">
          <p className="truncate text-[11.5px] text-[color:var(--color-admin-muted)]">{adminEmail}</p>
          <Link
            href="/app/companions"
            className="mt-1 block text-[11.5px] text-accent transition-colors hover:text-accent/80"
          >
            Back to the product
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-4 border-b border-[color:var(--admin-line)] px-5 py-4 sm:px-7">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] tracking-[-0.02em] text-[color:var(--color-admin-ink)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[12.5px] text-[color:var(--color-admin-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </header>
      <main id="main" className="flex-1 px-5 py-6 sm:px-7">
        {children}
      </main>
    </>
  );
}

export function AdminCard({
  children,
  className,
  title,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        'rounded-[14px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-surface)]',
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--admin-line)] px-4 py-3">
          <h2 className="text-[13px] font-[520] text-[color:var(--color-admin-ink)]">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={clsx(title ? 'p-4' : 'p-4')}>{children}</div>
    </section>
  );
}

export function AdminStat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-[color:var(--color-admin-muted)]">{label}</p>
      <p
        className={clsx(
          'mt-1 text-[21px] font-[560] tracking-[-0.025em] tabular-nums',
          tone === 'good'
            ? 'text-success'
            : tone === 'warn'
              ? 'text-warning'
              : tone === 'bad'
                ? 'text-danger'
                : 'text-[color:var(--color-admin-ink)]',
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[11px] text-[color:var(--color-admin-muted)]/80">{hint}</p>
      ) : null}
    </div>
  );
}

export function AdminTable({
  head,
  children,
  empty,
}: {
  head: string[];
  children: React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto scrollbar-slim">
      <table className="w-full min-w-[42rem] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[color:var(--admin-line)]">
            {head.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-3 py-2 text-left font-[520] text-[color:var(--color-admin-muted)]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--admin-line)]">{children}</tbody>
      </table>
      {empty ? (
        <p className="px-3 py-8 text-center text-[12.5px] text-[color:var(--color-admin-muted)]">
          {empty}
        </p>
      ) : null}
    </div>
  );
}

export function AdminBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-[500]',
        tone === 'good'
          ? 'bg-success/15 text-success'
          : tone === 'warn'
            ? 'bg-warning/15 text-warning'
            : tone === 'bad'
              ? 'bg-danger/18 text-danger'
              : tone === 'accent'
                ? 'bg-accent/18 text-accent'
                : 'bg-[color:var(--color-admin-elevated)] text-[color:var(--color-admin-muted)]',
      )}
    >
      {children}
    </span>
  );
}
