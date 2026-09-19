import { MODEL_PRICING, formatPercent, formatUsd } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { providerStats, systemHealth } from '@/server/services/admin-ops';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminProvidersPage() {
  await requireSuperAdmin();

  // Probing the provider costs a request, so it is only done on this page.
  const [stats, health] = await Promise.all([
    providerStats(),
    systemHealth({ probeProviders: true }),
  ]);

  return (
    <AdminPage
      title="AI & providers"
      description="One provider is enabled for production. Secrets come only from the environment and are never displayed."
    >
      <AdminCard
        title="OpenAI"
        action={
          health.openai.configured ? (
            <AdminBadge tone={health.openai.healthy === false ? 'bad' : 'good'}>
              {health.openai.healthy === false ? 'Unreachable' : 'Configured'}
            </AdminBadge>
          ) : (
            <AdminBadge tone="bad">Not configured</AdminBadge>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat label="Answer model" value={<span className="text-[15px]">{stats.answerModel}</span>} />
          <AdminStat
            label="Embedding model"
            value={<span className="text-[15px]">{stats.embeddingModel}</span>}
          />
          <AdminStat
            label="Requests today"
            value={stats.requestsToday}
            hint={`${stats.errorsToday} errors`}
            tone={stats.errorRate > 0.05 ? 'warn' : 'default'}
          />
          <AdminStat
            label="Average latency"
            value={`${stats.averageLatencyMs}ms`}
            hint="Answer requests"
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat label="Spend today" value={formatUsd(stats.spendTodayUsd, 4)} />
          <AdminStat label="Spend month to date" value={formatUsd(stats.spendMonthUsd, 2)} />
          <AdminStat label="Error rate" value={formatPercent(stats.errorRate, 1)} tone={stats.errorRate > 0.05 ? 'bad' : 'good'} />
          <AdminStat
            label="Cached token ratio"
            value={formatPercent(stats.cachedTokenRatio, 1)}
            hint="Prompt cache"
          />
        </div>

        {health.openai.latencyMs !== null ? (
          <p className="mt-4 text-[11.5px] text-[color:var(--color-admin-muted)]">
            Live probe: {health.openai.healthy ? 'reachable' : 'failed'} in {health.openai.latencyMs}
            ms{health.openai.message ? ` (${health.openai.message})` : ''}.
          </p>
        ) : null}
      </AdminCard>

      <AdminCard title="Model pricing" className="mt-4">
        <AdminTable head={['Model', 'Input / 1M', 'Cached input / 1M', 'Output / 1M', 'Effective from']}>
          {Object.entries(MODEL_PRICING).map(([model, pricing]) => (
            <tr key={model}>
              <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-ink)]">
                {model}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatUsd(pricing.inputPerMillionUsd, 4)}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatUsd(pricing.cachedInputPerMillionUsd, 4)}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatUsd(pricing.outputPerMillionUsd, 4)}</td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {pricing.effectiveFrom}
              </td>
            </tr>
          ))}
        </AdminTable>
        <p className="mt-3 text-[11.5px] text-[color:var(--color-admin-muted)]">
          Prices are declared once, in <span className="font-mono">packages/shared/src/ai-pricing.ts</span>.
          Every cost figure in the product derives from this table.
        </p>
      </AdminCard>
    </AdminPage>
  );
}
