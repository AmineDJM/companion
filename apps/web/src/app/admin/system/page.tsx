import { formatDateTime, formatPercent, formatRelativeTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { systemHealth } from '@/server/services/admin-ops';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  await requireSuperAdmin();
  const health = await systemHealth({ probeProviders: true });

  const checks = [
    { name: 'Web service', healthy: health.web.healthy, detail: `${health.web.latencyMs}ms` },
    {
      name: 'PostgreSQL',
      healthy: health.database.healthy,
      detail: health.database.message ?? `${health.database.latencyMs}ms`,
    },
    {
      name: 'Redis',
      healthy: health.redis?.healthy ?? false,
      detail: health.redis ? (health.redis.message ?? `${health.redis.latencyMs}ms`) : 'not configured',
    },
    {
      name: 'Object storage',
      healthy: health.storage.healthy,
      detail: health.storage.message ?? `${health.storage.latencyMs}ms`,
    },
    {
      name: 'OpenAI',
      healthy: health.openai.healthy ?? health.openai.configured,
      detail: health.openai.configured
        ? (health.openai.message ?? `${health.openai.latencyMs ?? 0}ms`)
        : 'not configured',
    },
    {
      name: 'Stripe',
      healthy: health.stripe.configured,
      detail: health.stripe.lastWebhookAt
        ? `last webhook ${formatRelativeTime(health.stripe.lastWebhookAt)}`
        : 'no webhooks received',
    },
  ];

  const workersAlive = health.workers.filter((worker) => worker.alive).length;

  return (
    <AdminPage title="System" description="Live dependency checks. No credentials are shown.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat
            label="Workers alive"
            value={workersAlive}
            hint={`${health.workers.length} registered`}
            tone={workersAlive === 0 ? 'bad' : 'good'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Queue backlog"
            value={health.queueBacklog ?? '—'}
            tone={(health.queueBacklog ?? 0) > 100 ? 'warn' : 'default'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Job failure rate"
            value={formatPercent(health.jobFailureRate, 1)}
            hint="Today"
            tone={health.jobFailureRate > 0.1 ? 'bad' : 'good'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Dependencies"
            value={`${checks.filter((check) => check.healthy).length}/${checks.length}`}
            tone={checks.every((check) => check.healthy) ? 'good' : 'warn'}
          />
        </AdminCard>
      </div>

      <AdminCard title="Dependencies" className="mt-4">
        <AdminTable head={['Service', 'Status', 'Detail']}>
          {checks.map((check) => (
            <tr key={check.name}>
              <td className="px-3 py-2 text-[color:var(--color-admin-ink)]">{check.name}</td>
              <td className="px-3 py-2">
                <AdminBadge tone={check.healthy ? 'good' : 'bad'}>
                  {check.healthy ? 'healthy' : 'unavailable'}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{check.detail}</td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <AdminCard title="Workers" className="mt-4">
        <AdminTable
          head={['Worker', 'Host', 'Active', 'Completed', 'Failed', 'Last heartbeat']}
          empty={health.workers.length === 0 ? 'No worker has ever registered.' : undefined}
        >
          {health.workers.map((worker) => (
            <tr key={worker.id}>
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {worker.id}
                {worker.alive ? null : <AdminBadge tone="bad">stale</AdminBadge>}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {worker.hostname ?? '—'}
              </td>
              <td className="px-3 py-2 tabular-nums">{worker.activeJobs}</td>
              <td className="px-3 py-2 tabular-nums">{worker.completedJobs}</td>
              <td className="px-3 py-2 tabular-nums text-danger">{worker.failedJobs}</td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatDateTime(worker.lastBeatAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>
    </AdminPage>
  );
}
