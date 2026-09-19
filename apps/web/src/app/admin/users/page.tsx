import Link from 'next/link';
import { desc, eq, or, schema, sql } from '@companion/db';
import { formatRelativeTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const pageSize = 50;

  const { db } = getContainer();
  const where = params.q
    ? or(
        sql`${schema.users.email} ILIKE ${`%${params.q.replace(/[%_]/g, (m) => `\\${m}`)}%`}`,
        sql`${schema.users.name} ILIKE ${`%${params.q.replace(/[%_]/g, (m) => `\\${m}`)}%`}`,
      )
    : undefined;

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      platformRole: schema.users.platformRole,
      emailVerifiedAt: schema.users.emailVerifiedAt,
      lastSeenAt: schema.users.lastSeenAt,
      suspendedAt: schema.users.suspendedAt,
      createdAt: schema.users.createdAt,
      workspaceId: schema.workspaceMembers.workspaceId,
      workspaceName: schema.workspaces.name,
      role: schema.workspaceMembers.role,
    })
    .from(schema.users)
    .leftJoin(schema.workspaceMembers, eq(schema.workspaceMembers.userId, schema.users.id))
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(where)
    .orderBy(desc(schema.users.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return (
    <AdminPage title="Users" description="Accounts across every workspace.">
      <form className="mb-4 flex gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Email or name"
          aria-label="Search users"
          className="h-9 min-w-56 flex-1 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-3 text-[13px] text-[color:var(--color-admin-ink)]"
        />
        <button
          type="submit"
          className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-[500] text-white hover:bg-accent-hover"
        >
          Search
        </button>
      </form>

      <AdminCard>
        <AdminTable
          head={['Email', 'Name', 'Workspace', 'Role', 'Verified', 'Last seen', 'Joined']}
          empty={users.length === 0 ? 'No users match.' : undefined}
        >
          {users.map((user) => (
            <tr key={`${user.id}-${user.workspaceId ?? 'none'}`} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2 text-[color:var(--color-admin-ink)]">
                {user.email}
                {user.platformRole === 'super_admin' ? (
                  <AdminBadge tone="accent">admin</AdminBadge>
                ) : null}
                {user.suspendedAt ? <AdminBadge tone="bad">suspended</AdminBadge> : null}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{user.name ?? '—'}</td>
              <td className="px-3 py-2">
                {user.workspaceId ? (
                  <Link
                    href={`/admin/customers/${user.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {user.workspaceName}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{user.role ?? '—'}</td>
              <td className="px-3 py-2">
                <AdminBadge tone={user.emailVerifiedAt ? 'good' : 'neutral'}>
                  {user.emailVerifiedAt ? 'yes' : 'no'}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {user.lastSeenAt ? formatRelativeTime(user.lastSeenAt) : 'never'}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatRelativeTime(user.createdAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <nav className="mt-4 flex items-center justify-center gap-3" aria-label="Pagination">
        {page > 1 ? (
          <Link
            href={`/admin/users?page=${page - 1}${params.q ? `&q=${params.q}` : ''}`}
            className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)]"
          >
            Previous
          </Link>
        ) : null}
        <span className="text-[12.5px] text-[color:var(--color-admin-muted)]">Page {page}</span>
        {users.length === pageSize ? (
          <Link
            href={`/admin/users?page=${page + 1}${params.q ? `&q=${params.q}` : ''}`}
            className="rounded-[8px] border border-[color:var(--admin-line)] px-3 py-1.5 text-[12.5px] text-[color:var(--color-admin-muted)]"
          >
            Next
          </Link>
        ) : null}
      </nav>
    </AdminPage>
  );
}
