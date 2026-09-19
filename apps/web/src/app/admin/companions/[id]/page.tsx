import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, schema, sql } from '@companion/db';
import {
  formatBytes,
  formatDateLong,
  formatDateTime,
  formatRelativeTime,
  formatUsd,
} from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { getCompanionById } from '@/server/services/companions';
import { listFiles } from '@/server/services/files';
import { usageSummary } from '@/server/services/usage';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';
import { CompanionOpsActions } from '@/components/admin/companion-ops';

export const dynamic = 'force-dynamic';

/**
 * Operational inspection of one Companion.
 *
 * Deliberately shows state, not content: an operator can diagnose and repair
 * processing without ever reading the customer's documents.
 */
export default async function AdminCompanionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const { db } = getContainer();

  const companion = await getCompanionById(id);
  if (!companion) notFound();

  const [workspace, files, jobs, usage, policy] = await Promise.all([
    db
      .select({ id: schema.workspaces.id, name: schema.workspaces.name, planKey: schema.workspaces.planKey })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, companion.workspaceId))
      .limit(1),
    listFiles(companion.id, { includeRemoved: true }),
    db
      .select({
        id: schema.processingJobs.id,
        type: schema.processingJobs.type,
        status: schema.processingJobs.status,
        attempts: schema.processingJobs.attempts,
        error: schema.processingJobs.error,
        durationMs: schema.processingJobs.durationMs,
        createdAt: schema.processingJobs.createdAt,
      })
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.companionId, companion.id))
      .orderBy(desc(schema.processingJobs.createdAt))
      .limit(40),
    usageSummary({ companionId: companion.id }),
    db
      .select({
        accessMode: schema.companions.accessMode,
        hasPassword: sql<boolean>`(SELECT password_hash IS NOT NULL FROM ${schema.companionAccessPolicies} p WHERE p.companion_id = ${companion.id})`,
        recipients: sql<number>`(SELECT count(*)::int FROM ${schema.recipientSessions} r WHERE r.companion_id = ${companion.id})`,
      })
      .from(schema.companions)
      .where(eq(schema.companions.id, companion.id))
      .limit(1),
  ]);

  const failedJobs = jobs.filter((job) => job.status === 'FAILED');

  return (
    <AdminPage
      title={companion.name}
      description={`/c/${companion.slug}`}
      actions={
        <AdminBadge
          tone={
            companion.effectiveStatus === 'ACTIVE'
              ? 'good'
              : companion.effectiveStatus === 'FAILED'
                ? 'bad'
                : 'neutral'
          }
        >
          {companion.effectiveStatus}
        </AdminBadge>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat label="Files" value={companion.fileCount} hint={`${files.length} rows including removed`} />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Indexed passages"
            value={companion.indexedChunks}
            hint={`${companion.indexedUnits} pages`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Questions"
            value={companion.questionCount}
            hint={`${companion.unansweredCount} unanswered`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat label="AI cost" value={formatUsd(usage.totalCostUsd, 4)} hint="All time" />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <AdminCard title="Configuration">
            <dl className="grid gap-3 text-[12.5px] sm:grid-cols-3">
              <Figure label="Owner workspace" value={workspace[0]?.name ?? '—'} href={`/admin/customers/${companion.workspaceId}`} />
              <Figure label="Plan" value={workspace[0]?.planKey ?? '—'} />
              <Figure label="Access mode" value={companion.accessMode} />
              <Figure label="Password set" value={policy[0]?.hasPassword ? 'yes' : 'no'} />
              <Figure label="Downloads" value={companion.downloadAllowed ? 'allowed' : 'disabled'} />
              <Figure label="Source protection" value={companion.sourceProtectionMode} />
              <Figure label="Questions" value={companion.aiEnabled ? 'enabled' : 'off'} />
              <Figure
                label="Expires"
                value={companion.expiresAt ? formatDateLong(companion.expiresAt) : 'never'}
              />
              <Figure label="Storage" value={formatBytes(companion.storageBytes)} />
              <Figure label="Views" value={String(companion.viewCount)} />
              <Figure label="Recipient sessions" value={String(policy[0]?.recipients ?? 0)} />
              <Figure label="Created" value={formatDateLong(companion.createdAt)} />
            </dl>
          </AdminCard>

          <AdminCard title="Files">
            <AdminTable head={['Path', 'Kind', 'Status', 'Pages', 'Versions', 'Size', 'Message']}>
              {files.map((file) => (
                <tr key={file.id}>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-[color:var(--color-admin-ink)]">
                    {file.path}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{file.kind}</td>
                  <td className="px-3 py-2">
                    <AdminBadge
                      tone={
                        file.status === 'READY'
                          ? 'good'
                          : file.status === 'FAILED' || file.status === 'UNSUPPORTED'
                            ? 'bad'
                            : 'neutral'
                      }
                    >
                      {file.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{file.pageCount ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{file.versionCount}</td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatBytes(file.sizeBytes)}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {file.statusMessage ?? ''}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>

          <AdminCard title="Processing jobs">
            <AdminTable
              head={['Type', 'Status', 'Attempts', 'Duration', 'Error', 'When']}
              empty={jobs.length === 0 ? 'No jobs recorded.' : undefined}
            >
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2 font-mono text-[11.5px]">{job.type}</td>
                  <td className="px-3 py-2">
                    <AdminBadge
                      tone={
                        job.status === 'COMPLETED'
                          ? 'good'
                          : job.status === 'FAILED'
                            ? 'bad'
                            : 'neutral'
                      }
                    >
                      {job.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{job.attempts}</td>
                  <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                    {job.durationMs ? `${Math.round(job.durationMs)}ms` : '—'}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-danger/85">
                    {job.error ?? ''}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatDateTime(job.createdAt)}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <CompanionOpsActions
            companionId={companion.id}
            status={companion.effectiveStatus}
            failedJobs={failedJobs.length}
          />

          <AdminCard title="Processing state">
            <dl className="space-y-2 text-[12.5px]">
              <Figure label="Progress" value={`${companion.processingProgress}%`} />
              <Figure label="Step" value={companion.processingStep ?? '—'} />
              <Figure label="Last opened" value={
                companion.lastOpenedAt ? formatRelativeTime(companion.lastOpenedAt) : 'never'
              } />
              {companion.processingError ? (
                <div>
                  <dt className="text-[11px] text-[color:var(--color-admin-muted)]">Error</dt>
                  <dd className="mt-0.5 text-[12px] leading-snug text-danger">
                    {companion.processingError}
                  </dd>
                </div>
              ) : null}
            </dl>
          </AdminCard>
        </div>
      </div>
    </AdminPage>
  );
}

function Figure({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[color:var(--color-admin-muted)]">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-[color:var(--color-admin-ink)]">
        {href ? (
          <Link href={href} className="hover:text-accent">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
