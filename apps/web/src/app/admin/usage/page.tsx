import Link from 'next/link';
import { COST_BASELINE, formatBytes, formatCompactNumber, formatPercent, formatUsd } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { startOfUtcDay, startOfUtcMonth } from '@/server/services/admin';
import {
  companionCosts,
  costBreakdown,
  dailyCosts,
  unprofitableWorkspaces,
  workspaceEconomics,
} from '@/server/services/admin-costs';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

/**
 * Unit economics.
 *
 * The page the business is run from: what a question costs, which customers
 * generate that cost, and where margin is negative. None of this is ever shown
 * to a customer.
 */
export default async function AdminUsagePage() {
  await requireSuperAdmin();

  const [today, month, series, byCost, byQuestions, unprofitable, companions] = await Promise.all([
    costBreakdown(startOfUtcDay()),
    costBreakdown(startOfUtcMonth()),
    dailyCosts(30),
    workspaceEconomics({ limit: 20, orderBy: 'cost' }),
    workspaceEconomics({ limit: 20, orderBy: 'questions' }),
    unprofitableWorkspaces(10),
    companionCosts(20),
  ]);

  const maxCost = Math.max(...series.map((point) => point.costUsd), 0.0001);
  const onTarget = month.averageCostPerQuestionUsd <= COST_BASELINE.targetCostPerQuestionUsd;

  return (
    <AdminPage title="Usage & costs" description="Month to date. Figures come from the usage ledger.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat
            label="AI cost this month"
            value={formatUsd(month.totalCostUsd, 2)}
            hint={`${formatUsd(today.totalCostUsd, 4)} today`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Cost / question"
            value={formatUsd(month.averageCostPerQuestionUsd, 5)}
            hint={`Target ${formatUsd(COST_BASELINE.targetCostPerQuestionUsd, 5)}`}
            tone={onTarget ? 'good' : 'warn'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Questions"
            value={formatCompactNumber(month.questions)}
            hint={`${formatCompactNumber(today.questions)} today`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Cached input ratio"
            value={formatPercent(month.cachedRatio, 1)}
            hint="Prompt cache hit rate"
          />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat label="Answer cost" value={formatUsd(month.answerCostUsd, 2)} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Indexing cost" value={formatUsd(month.embeddingCostUsd, 4)} hint="Embeddings" />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Input tokens"
            value={formatCompactNumber(month.inputTokens)}
            hint={`${formatCompactNumber(Math.round(month.inputTokens / Math.max(month.questions, 1)))} per question`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Output tokens"
            value={formatCompactNumber(month.outputTokens)}
            hint={`${formatCompactNumber(Math.round(month.outputTokens / Math.max(month.questions, 1)))} per answer`}
          />
        </AdminCard>
      </div>

      <AdminCard title="Daily cost" className="mt-4">
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="Daily AI cost">
          {series.map((point) => (
            <div key={point.day} className="group relative flex-1">
              <div
                className="w-full rounded-t-[2px] bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${Math.max((point.costUsd / maxCost) * 96, 1)}px` }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-[color:var(--color-admin-elevated)] px-2 py-1 text-[11px] text-[color:var(--color-admin-ink)] group-hover:block">
                {point.day}: {formatUsd(point.costUsd, 4)} · {point.questions} questions
              </span>
            </div>
          ))}
        </div>
      </AdminCard>

      {unprofitable.length > 0 ? (
        <AdminCard title="Potentially unprofitable customers" className="mt-4">
          <AdminTable head={['Workspace', 'Plan', 'Questions', 'AI cost', 'Revenue', 'Margin']}>
            {unprofitable.map((row) => (
              <tr key={row.workspaceId}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.workspaceName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <AdminBadge>{row.planKey}</AdminBadge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.questions}</td>
                <td className="px-3 py-2 tabular-nums">{formatUsd(row.costUsd, 4)}</td>
                <td className="px-3 py-2 tabular-nums">{formatUsd(row.revenueUsd, 2)}</td>
                <td className="px-3 py-2 tabular-nums text-danger">{formatUsd(row.marginUsd, 4)}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Top 20 by cost">
          <AdminTable
            head={['Workspace', 'Questions', 'Cost', 'Cost / question']}
            empty={byCost.length === 0 ? 'No usage yet.' : undefined}
          >
            {byCost.map((row) => (
              <tr key={row.workspaceId}>
                <td className="max-w-[12rem] truncate px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.workspaceName}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.questions}</td>
                <td className="px-3 py-2 tabular-nums">{formatUsd(row.costUsd, 4)}</td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                  {formatUsd(row.costPerQuestionUsd, 5)}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Top 20 by usage">
          <AdminTable
            head={['Workspace', 'Plan', 'Questions', 'Storage']}
            empty={byQuestions.length === 0 ? 'No usage yet.' : undefined}
          >
            {byQuestions.map((row) => (
              <tr key={row.workspaceId}>
                <td className="max-w-[12rem] truncate px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.workspaceName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <AdminBadge>{row.planKey}</AdminBadge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.questions}</td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {formatBytes(row.storageBytes)}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      </div>

      <AdminCard title="Cost by Companion" className="mt-4">
        <AdminTable
          head={['Companion', 'Workspace', 'Questions', 'Cost', 'Storage']}
          empty={companions.length === 0 ? 'No Companions yet.' : undefined}
        >
          {companions.map((row) => (
            <tr key={row.companionId}>
              <td className="max-w-[14rem] truncate px-3 py-2">
                <Link
                  href={`/admin/companions/${row.companionId}`}
                  className="text-[color:var(--color-admin-ink)] hover:text-accent"
                >
                  {row.companionName}
                </Link>
              </td>
              <td className="max-w-[10rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {row.workspaceName}
              </td>
              <td className="px-3 py-2 tabular-nums">{row.questions}</td>
              <td className="px-3 py-2 tabular-nums">{formatUsd(row.costUsd, 4)}</td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatBytes(row.storageBytes)}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>
    </AdminPage>
  );
}
