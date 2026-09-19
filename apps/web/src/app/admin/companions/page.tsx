import Link from 'next/link';
import { COMPANION_STATUSES, formatBytes, formatRelativeTime } from '@companion/shared';
import { desc, eq, isNull, or, schema, sql } from '@companion/db';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminCompanionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 50;

  const { db } = getContainer();
  const conditions = [isNull(schema.companions.deletedAt)];
  if (params.status) conditions.push(eq(schema.companions.status, params.status as never));
  if (params.q) {
    const pattern = `%${params.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const clause = or(
      sql`${schema.companions.name} ILIKE ${pattern}`,
      eq(schema.companions.slug, params.q),
    );
    if (clause) conditions.push(clause);
  }

  const rows = await db
    .select({
      id: schema.companions.id,
      name: schema.companions.name,
      slug: schema.companions.slug,
      status: schema.companions.status,
      workspaceId: schema.companions.workspaceId,
      workspaceName: schema.workspaces.name,
      fileCount: schema.companions.fileCount,
      viewCount: schema.companions.viewCount,
      questionCount: schema.companions.questionCount,
      indexedChunks: schema.companions.indexedChunks,
      storageBytes: schema.companions.storageBytes,
      createdAt: schema.companions.createdAt,
    })
    .from(schema.companions)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.companions.workspaceId))
    .where(sql.join(conditions, sql` AND `))
    .orderBy(desc(schema.companions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return (
    <AdminPage title="Companions" description="Every Companion on the platform.">
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Name or exact slug"
          aria-label="Search Companions"
          className="h-9 min-w-56 flex-1 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-3 text-[13px] text-[color:var(--color-admin-ink)]"
        />
        <select
          name="status"
          defaultValue={params.status ?? ''}
          aria-label="Filter by status"
          className="h-9 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[13px] text-[color:var(--color-admin-ink)]"
        >
          <option value="">All statuses</option>
          {COMPANION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-[500] text-white hover:bg-accent-hover"
        >
          Search
        </button>
      </form>

      <AdminCard>
        <AdminTable
          head={['Companion', 'Workspace', 'Status', 'Files', 'Indexed', 'Views', 'Questions', 'Storage', 'Created']}
          empty={rows.length === 0 ? 'No Companions match.' : undefined}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="max-w-[14rem] px-3 py-2">
                <Link
                  href={`/admin/companions/${row.id}`}
                  className="block truncate text-[color:var(--color-admin-ink)] hover:text-accent"
                >
                  {row.name}
                </Link>
                <span className="font-mono text-[11px] text-[color:var(--color-admin-muted)]">
                  /c/{row.slug}
                </span>
              </td>
              <td className="max-w-[10rem] truncate px-3 py-2">
                <Link
                  href={`/admin/customers/${row.workspaceId}`}
                  className="text-[color:var(--color-admin-muted)] hover:text-accent"
                >
                  {row.workspaceName}
                </Link>
              </td>
              <td className="px-3 py-2">
                <AdminBadge
                  tone={
                    row.status === 'ACTIVE'
                      ? 'good'
                      : row.status === 'FAILED' || row.status === 'REVOKED'
                        ? 'bad'
                        : 'neutral'
                  }
                >
                  {row.status}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 tabular-nums">{row.fileCount}</td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                {row.indexedChunks}
              </td>
              <td className="px-3 py-2 tabular-nums">{row.viewCount}</td>
              <td className="px-3 py-2 tabular-nums">{row.questionCount}</td>
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
    </AdminPage>
  );
}
