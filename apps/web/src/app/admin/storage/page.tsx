import Link from 'next/link';
import { desc, eq, isNull, schema, sql } from '@companion/db';
import { formatBytes } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

/**
 * Storage accounting.
 *
 * Read-only by design: deletion always goes through the domain services so the
 * database and the bucket cannot drift apart. Pending reclamations are shown so
 * an operator can see nothing has been orphaned.
 */
export default async function AdminStoragePage() {
  await requireSuperAdmin();
  const { db } = getContainer();

  const [totals, byKind, workspaces, companions, largestFiles, reclamations] = await Promise.all([
    db
      .select({
        originals: sql<number>`(SELECT coalesce(sum(size_bytes), 0)::bigint FROM ${schema.fileVersions})`,
        derived: sql<number>`(SELECT coalesce(sum(size_bytes), 0)::bigint FROM ${schema.previewArtifacts})`,
        companionTotal: sql<number>`(SELECT coalesce(sum(storage_bytes), 0)::bigint FROM ${schema.companions} WHERE deleted_at IS NULL)`,
      })
      .from(sql`(SELECT 1) AS anchor`),
    db
      .select({
        kind: schema.previewArtifacts.kind,
        bytes: sql<number>`coalesce(sum(${schema.previewArtifacts.sizeBytes}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.previewArtifacts)
      .groupBy(schema.previewArtifacts.kind),
    db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        planKey: schema.workspaces.planKey,
        bytes: schema.workspaces.storageBytesUsed,
      })
      .from(schema.workspaces)
      .where(isNull(schema.workspaces.deletedAt))
      .orderBy(desc(schema.workspaces.storageBytesUsed))
      .limit(15),
    db
      .select({
        id: schema.companions.id,
        name: schema.companions.name,
        workspaceName: schema.workspaces.name,
        bytes: schema.companions.storageBytes,
        fileCount: schema.companions.fileCount,
      })
      .from(schema.companions)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.companions.workspaceId))
      .where(isNull(schema.companions.deletedAt))
      .orderBy(desc(schema.companions.storageBytes))
      .limit(15),
    db
      .select({
        id: schema.fileVersions.id,
        filename: schema.fileVersions.originalFilename,
        bytes: schema.fileVersions.sizeBytes,
        companionName: schema.companions.name,
        companionId: schema.companions.id,
      })
      .from(schema.fileVersions)
      .innerJoin(schema.companions, eq(schema.companions.id, schema.fileVersions.companionId))
      .orderBy(desc(schema.fileVersions.sizeBytes))
      .limit(15),
    db
      .select({
        pending: sql<number>`count(*) FILTER (WHERE deleted_at IS NULL)::int`,
        failed: sql<number>`count(*) FILTER (WHERE deleted_at IS NULL AND error IS NOT NULL)::int`,
        bytes: sql<number>`coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NULL), 0)::bigint`,
      })
      .from(schema.storageReclamations),
  ]);

  const row = totals[0];

  return (
    <AdminPage title="Storage" description="Originals, derived previews and pending reclamation.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat label="Original files" value={formatBytes(Number(row?.originals ?? 0))} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Derived assets" value={formatBytes(Number(row?.derived ?? 0))} hint="Page images, previews, thumbnails" />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Total"
            value={formatBytes(Number(row?.originals ?? 0) + Number(row?.derived ?? 0))}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Pending reclamation"
            value={formatBytes(Number(reclamations[0]?.bytes ?? 0))}
            hint={`${reclamations[0]?.pending ?? 0} objects · ${reclamations[0]?.failed ?? 0} failed`}
            tone={(reclamations[0]?.failed ?? 0) > 0 ? 'warn' : 'default'}
          />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Derived assets by kind">
          <AdminTable head={['Kind', 'Objects', 'Size']} empty={byKind.length === 0 ? 'None yet.' : undefined}>
            {byKind.map((entry) => (
              <tr key={entry.kind}>
                <td className="px-3 py-2 font-mono text-[11.5px]">{entry.kind}</td>
                <td className="px-3 py-2 tabular-nums">{entry.count}</td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(Number(entry.bytes))}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Largest workspaces">
          <AdminTable head={['Workspace', 'Plan', 'Storage']} empty={workspaces.length === 0 ? 'None yet.' : undefined}>
            {workspaces.map((workspace) => (
              <tr key={workspace.id}>
                <td className="max-w-[12rem] truncate px-3 py-2">
                  <Link
                    href={`/admin/customers/${workspace.id}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {workspace.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{workspace.planKey}</td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(workspace.bytes)}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Largest Companions">
          <AdminTable head={['Companion', 'Workspace', 'Files', 'Storage']} empty={companions.length === 0 ? 'None yet.' : undefined}>
            {companions.map((companion) => (
              <tr key={companion.id}>
                <td className="max-w-[12rem] truncate px-3 py-2">
                  <Link
                    href={`/admin/companions/${companion.id}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {companion.name}
                  </Link>
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {companion.workspaceName}
                </td>
                <td className="px-3 py-2 tabular-nums">{companion.fileCount}</td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(companion.bytes)}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Largest files">
          <AdminTable head={['File', 'Companion', 'Size']} empty={largestFiles.length === 0 ? 'None yet.' : undefined}>
            {largestFiles.map((file) => (
              <tr key={file.id}>
                <td className="max-w-[12rem] truncate px-3 py-2 text-[color:var(--color-admin-ink)]">
                  {file.filename}
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {file.companionName}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(file.bytes)}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      </div>

      <p className="mt-4 text-[11.5px] text-[color:var(--color-admin-muted)]">
        Objects are never deleted from this page. Removal happens through the domain services so the
        database and the bucket stay consistent.
      </p>
    </AdminPage>
  );
}
