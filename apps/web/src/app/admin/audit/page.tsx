import Link from 'next/link';
import { desc, eq, or, schema, sql } from '@companion/db';
import { formatDateTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

/** Immutable operational trail. Document content is never recorded here. */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; actor?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 60;

  const { db } = getContainer();
  const conditions = [];
  if (params.actor) conditions.push(eq(schema.auditLogs.actorType, params.actor));
  if (params.q) {
    const pattern = `%${params.q.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const clause = or(
      sql`${schema.auditLogs.action} ILIKE ${pattern}`,
      sql`${schema.auditLogs.actorLabel} ILIKE ${pattern}`,
      sql`${schema.auditLogs.targetLabel} ILIKE ${pattern}`,
    );
    if (clause) conditions.push(clause);
  }
  const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;

  const entries = await db
    .select({
      id: schema.auditLogs.id,
      createdAt: schema.auditLogs.createdAt,
      actorType: schema.auditLogs.actorType,
      actorLabel: schema.auditLogs.actorLabel,
      actorEmail: schema.users.email,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      targetLabel: schema.auditLogs.targetLabel,
      workspaceId: schema.auditLogs.workspaceId,
      metadata: schema.auditLogs.metadata,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return (
    <AdminPage title="Audit log" description="Every state change, by whom and when.">
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Action, actor or target"
          aria-label="Search the audit log"
          className="h-9 min-w-56 flex-1 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-3 text-[13px] text-[color:var(--color-admin-ink)]"
        />
        <select
          name="actor"
          defaultValue={params.actor ?? ''}
          aria-label="Filter by actor"
          className="h-9 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[13px] text-[color:var(--color-admin-ink)]"
        >
          <option value="">All actors</option>
          <option value="user">Customer</option>
          <option value="admin">Operator</option>
          <option value="system">System</option>
          <option value="stripe">Stripe</option>
        </select>
        <button
          type="submit"
          className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-[500] text-white hover:bg-accent-hover"
        >
          Filter
        </button>
      </form>

      <AdminCard>
        <AdminTable
          head={['When', 'Actor', 'Action', 'Target', 'Detail']}
          empty={entries.length === 0 ? 'No entries match.' : undefined}
        >
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="whitespace-nowrap px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatDateTime(entry.createdAt)}
              </td>
              <td className="px-3 py-2">
                <AdminBadge tone={entry.actorType === 'admin' ? 'accent' : 'neutral'}>
                  {entry.actorType}
                </AdminBadge>
                <span className="ml-1.5 text-[11.5px] text-[color:var(--color-admin-muted)]">
                  {entry.actorEmail ?? entry.actorLabel ?? ''}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {entry.action}
              </td>
              <td className="max-w-[14rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {entry.workspaceId ? (
                  <Link
                    href={`/admin/customers/${entry.workspaceId}`}
                    className="hover:text-accent"
                  >
                    {entry.targetLabel ?? entry.targetType ?? 'workspace'}
                  </Link>
                ) : (
                  (entry.targetLabel ?? entry.targetType ?? '—')
                )}
              </td>
              <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-[11px] text-[color:var(--color-admin-muted)]">
                {entry.metadata ? JSON.stringify(entry.metadata) : ''}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <nav className="mt-4 flex items-center justify-center gap-3" aria-label="Pagination">
        {page > 1 ? (
          <Link
            href={`/admin/audit?page=${page - 1}`}
            className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]"
          >
            Previous
          </Link>
        ) : null}
        <span className="text-[12.5px] text-[color:var(--color-admin-muted)]">Page {page}</span>
        {entries.length === pageSize ? (
          <Link
            href={`/admin/audit?page=${page + 1}`}
            className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]"
          >
            Next
          </Link>
        ) : null}
      </nav>
    </AdminPage>
  );
}
