import { formatRelativeTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { qualityOverview, recentQualityRuns, type MetricRow } from '@/server/services/admin-quality';
import {
  conversionToolingCheck,
  productionReadiness,
  type ReadinessCheck,
} from '@/server/services/readiness';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';
import { EvaluationRunner } from '@/components/admin/evaluation-runner';

export const dynamic = 'force-dynamic';

/**
 * The quality console.
 *
 * Every metric in the specification, its live value, and the evidence behind
 * the last failure. There is deliberately no overall score: a single number
 * would let a fast, cheap, well-liked release hide a cross-tenant leak.
 */
function statusTone(status: MetricRow['status']): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'pass') return 'good';
  if (status === 'warn') return 'warn';
  if (status === 'fail') return 'bad';
  return 'neutral';
}

function formatValue(row: MetricRow): string {
  if (row.latestValue === null) return '—';
  const { unit } = row.definition;
  if (unit === 'ratio') return `${(row.latestValue * 100).toFixed(2)}%`;
  if (unit === 'percent') return `${row.latestValue.toFixed(2)}%`;
  if (unit === 'milliseconds') return `${Math.round(row.latestValue)} ms`;
  if (unit === 'usd') return `$${row.latestValue.toFixed(6)}`;
  if (unit === 'count') return String(Math.round(row.latestValue));
  return row.latestValue.toFixed(4);
}

function formatTarget(row: MetricRow): string {
  const { unit, target, comparison } = row.definition;
  const symbol = comparison === 'lte' ? '≤' : comparison === 'gte' ? '≥' : '=';
  if (unit === 'ratio') return `${symbol} ${(target * 100).toFixed(2)}%`;
  if (unit === 'milliseconds') return `${symbol} ${target} ms`;
  if (unit === 'usd') return `${symbol} $${target}`;
  return `${symbol} ${target}`;
}

function readinessTone(status: ReadinessCheck['status']): 'good' | 'warn' | 'bad' {
  return status === 'PASS' ? 'good' : status === 'WARNING' ? 'warn' : 'bad';
}

export default async function AdminQualityPage() {
  await requireSuperAdmin();
  const [overview, runs, readiness, conversion] = await Promise.all([
    qualityOverview(),
    recentQualityRuns(),
    productionReadiness(),
    conversionToolingCheck(),
  ]);

  // The conversion probe needs the worker's heartbeat, so it is gathered
  // separately and folded in here rather than inside the report.
  const checks = [...readiness.checks, conversion];
  const passed = checks.filter((check) => check.status === 'PASS').length;
  const blocking = checks.filter((check) => check.status === 'CRITICAL');
  const advisory = checks.filter((check) => check.status === 'WARNING');
  const groups = new Map<ReadinessCheck['group'], ReadinessCheck[]>();
  for (const check of checks) {
    groups.set(check.group, [...(groups.get(check.group) ?? []), check]);
  }

  const byDomain = new Map<string, MetricRow[]>();
  for (const metric of overview.metrics) {
    byDomain.set(metric.domain, [...(byDomain.get(metric.domain) ?? []), metric]);
  }

  return (
    <AdminPage
      title="Quality"
      description={`Specification ${overview.qualitySpecVersion} · last ${overview.windowHours} hours of evidence`}
      actions={<EvaluationRunner />}
    >
      <AdminCard
        className="mb-6"
        title="Production readiness"
        action={
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-[15px] text-[color:var(--color-admin-ink)]">
              {passed} / {checks.length}
            </span>
            <AdminBadge tone={blocking.length > 0 ? 'bad' : advisory.length > 0 ? 'warn' : 'good'}>
              {blocking.length > 0
                ? `${blocking.length} blocking`
                : advisory.length > 0
                  ? `${advisory.length} to review`
                  : 'ready'}
            </AdminBadge>
          </div>
        }
      >
        <div className="border-b border-[color:var(--admin-line)] px-4 py-2.5 text-[12px] text-[color:var(--color-admin-muted)]">
          {readiness.environment} · build {readiness.release}
          {readiness.serviceName ? ` · ${readiness.serviceName}` : ''}
        </div>
        {[...groups.entries()].map(([group, entries]) => (
          <div key={group} className="border-b border-[color:var(--admin-line)] last:border-b-0">
            <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-[0.06em] text-[color:var(--color-admin-muted)]">
              {group}
            </div>
            {entries.map((check) => (
              <div
                key={check.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="min-w-[13rem] text-[13px] text-[color:var(--color-admin-ink)]">
                  {check.label}
                </span>
                <AdminBadge tone={readinessTone(check.status)}>{check.status}</AdminBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-[color:var(--color-admin-muted)]">
                    {check.detail}
                  </p>
                  {check.remediation ? (
                    <p className="mt-0.5 text-[12.5px] text-[color:var(--color-admin-ink)] opacity-80">
                      {check.remediation}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
      </AdminCard>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStat label="Passing" value={String(overview.counts.pass)} />
        <AdminStat label="Warnings" value={String(overview.counts.warn)} />
        <AdminStat label="Blocking failures" value={String(overview.blocking.length)} />
        <AdminStat label="Never measured" value={String(overview.counts.unmeasured)} />
      </div>

      {overview.blocking.length > 0 ? (
        <AdminCard className="mb-6" title="Blocking failures">
          <div className="divide-y divide-[color:var(--admin-line)]">
            {overview.blocking.map((metric) => (
              <div key={metric.definition.metricId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="bad">{metric.definition.severity}</AdminBadge>
                  <span className="font-mono text-[12px] text-[color:var(--color-admin-ink)]">
                    {metric.definition.metricId}
                  </span>
                  <span className="text-[12.5px] text-[color:var(--color-admin-muted)]">
                    {formatValue(metric)} against {formatTarget(metric)}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-[color:var(--color-admin-muted)]">
                  {metric.definition.description}
                </p>
                <p className="mt-1 text-[12px] text-[color:var(--color-admin-muted)]">
                  Repair strategy: <span className="font-mono">{metric.definition.repairStrategy}</span>
                  {metric.repairsAttempted > 0
                    ? ` · ${metric.repairsSucceeded}/${metric.repairsAttempted} repaired`
                    : ''}
                </p>
                {metric.lastFailureEvidence ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-[8px] bg-[color:var(--color-admin-canvas)] p-2.5 text-[11px] leading-[1.5] text-[color:var(--color-admin-muted)]">
                    {JSON.stringify(metric.lastFailureEvidence, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </AdminCard>
      ) : null}

      {[...byDomain.entries()].map(([domain, metrics]) => (
        <AdminCard key={domain} className="mb-5" title={domain}>
          <AdminTable head={['Metric', 'Value', 'Target', 'Origin', 'Samples', 'Status', 'Measured']}>
            {metrics.map((metric) => (
              <tr
                key={metric.definition.metricId}
                className="hover:bg-[color:var(--color-admin-elevated)]/40"
              >
                <td className="px-3 py-2">
                  <div className="font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                    {metric.definition.metricId}
                  </div>
                  <div className="mt-0.5 max-w-xl text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {metric.definition.description}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums text-[12.5px] text-[color:var(--color-admin-ink)]">
                  {formatValue(metric)}
                </td>
                <td className="px-3 py-2 tabular-nums text-[12.5px] text-[color:var(--color-admin-muted)]">
                  {formatTarget(metric)}
                </td>
                <td className="px-3 py-2 text-[11px] text-[color:var(--color-admin-muted)]">
                  {metric.definition.thresholdOrigin}
                  {metric.definition.standardReference ? (
                    <div className="mt-0.5 max-w-[22rem] truncate text-[10.5px] opacity-70">
                      {metric.definition.standardReference}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums text-[12px] text-[color:var(--color-admin-muted)]">
                  {metric.sampleSize ?? '—'}
                  {metric.measurements > 0 ? (
                    <span className="opacity-60"> · {metric.measurements} runs</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <AdminBadge tone={statusTone(metric.status)}>
                    {metric.status === 'unmeasured' ? 'not measured' : metric.status}
                  </AdminBadge>
                </td>
                <td className="px-3 py-2 text-[12px] text-[color:var(--color-admin-muted)]">
                  {metric.measuredAt ? formatRelativeTime(metric.measuredAt) : '—'}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      ))}

      <AdminCard className="mb-5" title="Evaluation runs">
        <AdminTable
          head={['Kind', 'Release', 'Result', 'Headline', 'Duration', 'When']}
          empty={runs.length === 0 ? 'No evaluation has been run yet.' : undefined}
        >
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {run.kind}
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-muted)]">
                {run.releaseId}
              </td>
              <td className="px-3 py-2">
                <AdminBadge tone={run.passed ? 'good' : 'bad'}>
                  {run.passed ? 'passed' : `${run.blockingFailures} blocking`}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 text-[12px] text-[color:var(--color-admin-muted)]">
                {run.summary ?? '—'}
              </td>
              <td className="px-3 py-2 tabular-nums text-[12px] text-[color:var(--color-admin-muted)]">
                {run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)}s`}
              </td>
              <td className="px-3 py-2 text-[12px] text-[color:var(--color-admin-muted)]">
                {formatRelativeTime(run.startedAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <AdminCard title="Releases">
        <AdminTable
          head={['Release', 'Measurements', 'Failures', 'Blocking', 'Last seen']}
          empty={overview.releaseComparison.length === 0 ? 'No evidence recorded yet.' : undefined}
        >
          {overview.releaseComparison.map((release) => (
            <tr key={release.releaseId} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {release.releaseId}
              </td>
              <td className="px-3 py-2 tabular-nums text-[12px] text-[color:var(--color-admin-muted)]">
                {release.measurements}
              </td>
              <td className="px-3 py-2 tabular-nums text-[12px] text-[color:var(--color-admin-muted)]">
                {release.failures}
              </td>
              <td className="px-3 py-2">
                <AdminBadge tone={release.blockingFailures > 0 ? 'bad' : 'good'}>
                  {release.blockingFailures}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 text-[12px] text-[color:var(--color-admin-muted)]">
                {formatRelativeTime(release.lastSeen)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>
    </AdminPage>
  );
}
