import Link from 'next/link';
import { PLAN_KEYS, formatBytes, formatRelativeTime, formatUsd, isFreePlan } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { listWorkspaces } from '@/server/services/admin';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const result = await listWorkspaces({
    query: params.q,
    planKey: params.plan,
    page,
    pageSize: 25,
  });

  return (
    <AdminPage
      title="Workspaces"
      description={`${result.total} workspace${result.total === 1 ? '' : 's'}`}
    >
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Name or owner email"
          aria-label="Search workspaces"
          className="h-9 min-w-56 flex-1 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-3 text-[13px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
        />
        <select
          name="plan"
          defaultValue={params.plan ?? ''}
          aria-label="Filter by plan"
          className="h-9 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[13px] text-[color:var(--color-admin-ink)] focus:border-accent focus:outline-none"
        >
          <option value="">All plans</option>
          {PLAN_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-[500] text-white transition-colors hover:bg-accent-hover"
        >
          Search
        </button>
      </form>

      <AdminCard>
        <AdminTable
          head={['Workspace', 'Owner', 'Plan', 'Companions', 'Questions', 'AI cost', 'Storage', 'Joined']}
          empty={result.items.length === 0 ? 'No workspaces match.' : undefined}
        >
          {result.items.map((row) => (
            <tr key={row.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2">
                <Link
                  href={`/admin/customers/${row.id}`}
                  className="text-[color:var(--color-admin-ink)] hover:text-accent"
                >
                  {row.name}
                </Link>
                {row.status === 'suspended' ? (
                  <AdminBadge tone="bad">suspended</AdminBadge>
                ) : null}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {row.ownerEmail ?? '—'}
              </td>
              <td className="px-3 py-2">
                <AdminBadge tone={isFreePlan(row.planKey) ? 'neutral' : 'accent'}>
                  {row.planKey}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-ink)]">
                {row.companions}
              </td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-ink)]">
                {row.questionsThisCycle}
              </td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-ink)]">
                {formatUsd(row.costUsdThisMonth, 4)}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatBytes(row.storageBytes)}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatRelativeTime(row.createdAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      {result.total > 25 ? (
        <nav className="mt-4 flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={`/admin/customers?page=${page - 1}${params.q ? `&q=${params.q}` : ''}`}
              className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-[12.5px] text-[color:var(--color-admin-muted)]">
            Page {page} of {Math.ceil(result.total / 25)}
          </span>
          {page * 25 < result.total ? (
            <Link
              href={`/admin/customers?page=${page + 1}${params.q ? `&q=${params.q}` : ''}`}
              className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </AdminPage>
  );
}
