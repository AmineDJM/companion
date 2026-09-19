import { JOB_STATUSES, JOB_TYPES, formatDuration, formatRelativeTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { listJobs } from '@/server/services/admin-ops';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';
import { JobRetryButton } from '@/components/admin/job-retry';

export const dynamic = 'force-dynamic';

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const result = await listJobs({
    status: params.status,
    type: params.type,
    page,
    pageSize: 50,
  });

  return (
    <AdminPage title="Jobs" description={`${result.total} processing jobs`}>
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <select
          name="status"
          defaultValue={params.status ?? ''}
          aria-label="Filter by status"
          className="h-9 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[13px] text-[color:var(--color-admin-ink)]"
        >
          <option value="">All statuses</option>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={params.type ?? ''}
          aria-label="Filter by type"
          className="h-9 rounded-[10px] border border-[color:var(--admin-line)] bg-[color:var(--color-admin-canvas)] px-2.5 text-[13px] text-[color:var(--color-admin-ink)]"
        >
          <option value="">All types</option>
          {JOB_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
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
          head={['Type', 'Status', 'Workspace', 'Companion', 'File', 'Attempts', 'Duration', 'When', '']}
          empty={result.items.length === 0 ? 'No jobs match.' : undefined}
        >
          {result.items.map((job) => (
            <tr key={job.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {job.type}
              </td>
              <td className="px-3 py-2">
                <AdminBadge
                  tone={
                    job.status === 'COMPLETED'
                      ? 'good'
                      : job.status === 'FAILED'
                        ? 'bad'
                        : job.status === 'RUNNING'
                          ? 'accent'
                          : 'neutral'
                  }
                >
                  {job.status}
                </AdminBadge>
                {job.status === 'RUNNING' ? (
                  <span className="ml-1.5 text-[11px] tabular-nums text-[color:var(--color-admin-muted)]">
                    {job.progress}%
                  </span>
                ) : null}
              </td>
              <td className="max-w-[10rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {job.workspaceName ?? '—'}
              </td>
              <td className="max-w-[10rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {job.companionName ?? '—'}
              </td>
              <td className="max-w-[10rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {job.fileName ?? '—'}
              </td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                {job.attempts}/{job.maxAttempts}
              </td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                {job.durationMs ? formatDuration(job.durationMs) : '—'}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatRelativeTime(job.createdAt)}
              </td>
              <td className="px-3 py-2">
                {job.status === 'FAILED' ? <JobRetryButton jobId={job.id} /> : null}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      {result.items.some((job) => job.error) ? (
        <AdminCard title="Recent errors" className="mt-4">
          <ul className="space-y-2">
            {result.items
              .filter((job) => job.error)
              .slice(0, 10)
              .map((job) => (
                <li key={job.id} className="border-l-2 border-danger/40 pl-2.5">
                  <p className="font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                    {job.type} · {job.companionName ?? 'unknown'}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-danger/85">{job.error}</p>
                </li>
              ))}
          </ul>
        </AdminCard>
      ) : null}
    </AdminPage>
  );
}
