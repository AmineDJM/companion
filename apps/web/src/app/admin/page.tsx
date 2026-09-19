import Link from 'next/link';
import { desc, eq, schema } from '@companion/db';
import {
  formatBytes,
  formatCurrencyCents,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  isFreePlan,
} from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { platformOverview, startOfUtcMonth } from '@/server/services/admin';
import { costAlerts } from '@/server/services/admin-costs';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  await requireSuperAdmin();
  const { db } = getContainer();

  const [overview, alerts, signups, upgrades, cancellations, failedPayments] = await Promise.all([
    platformOverview(),
    costAlerts(),
    db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        email: schema.users.email,
        createdAt: schema.workspaces.createdAt,
        planKey: schema.workspaces.planKey,
      })
      .from(schema.workspaces)
      .leftJoin(schema.users, eq(schema.users.id, schema.workspaces.ownerId))
      .orderBy(desc(schema.workspaces.createdAt))
      .limit(6),
    db
      .select({
        workspaceId: schema.subscriptions.workspaceId,
        planKey: schema.subscriptions.planKey,
        amountCents: schema.subscriptions.amountCents,
        createdAt: schema.subscriptions.createdAt,
        name: schema.workspaces.name,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.subscriptions.workspaceId))
      .where(eq(schema.subscriptions.status, 'active'))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(5),
    db
      .select({
        workspaceId: schema.subscriptions.workspaceId,
        name: schema.workspaces.name,
        planKey: schema.subscriptions.planKey,
        canceledAt: schema.subscriptions.canceledAt,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.subscriptions.workspaceId))
      .where(eq(schema.subscriptions.status, 'canceled'))
      .orderBy(desc(schema.subscriptions.canceledAt))
      .limit(5),
    db
      .select({
        id: schema.payments.id,
        workspaceId: schema.payments.workspaceId,
        name: schema.workspaces.name,
        amountDueCents: schema.payments.amountDueCents,
        currency: schema.payments.currency,
        attemptCount: schema.payments.attemptCount,
        occurredAt: schema.payments.occurredAt,
      })
      .from(schema.payments)
      .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.payments.workspaceId))
      .where(eq(schema.payments.status, 'failed'))
      .orderBy(desc(schema.payments.occurredAt))
      .limit(5),
  ]);

  return (
    <AdminPage title="Overview" description="Live platform state. Every figure is read from real data.">
      {alerts.length > 0 ? (
        <div className="mb-5 space-y-2">
          {alerts.map((alert, index) => (
            <div
              key={index}
              className={`rounded-[12px] border px-4 py-3 ${
                alert.severity === 'critical'
                  ? 'border-danger/30 bg-danger/10'
                  : 'border-warning/30 bg-warning/10'
              }`}
            >
              <p
                className={`text-[13px] font-[520] ${alert.severity === 'critical' ? 'text-danger' : 'text-warning'}`}
              >
                {alert.title}
              </p>
              <p className="mt-0.5 text-[12px] text-[color:var(--color-admin-muted)]">
                {alert.detail}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat
            label="MRR"
            value={formatCurrencyCents(overview.mrrCents)}
            hint={`ARR ${formatCurrencyCents(overview.arrCents)}`}
            tone="good"
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Active subscriptions"
            value={overview.activeSubscriptions}
            hint={`${overview.freeWorkspaces} free · ${overview.trialingSubscriptions} trialing`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="AI cost today"
            value={formatUsd(overview.aiCostTodayUsd, 4)}
            hint={`${formatUsd(overview.aiCostMonthUsd, 2)} this month`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Cost / question"
            value={formatUsd(overview.averageCostPerQuestionUsd, 5)}
            hint="Month to date"
            tone={overview.averageCostPerQuestionUsd > 0.004 ? 'warn' : 'default'}
          />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat label="Active Companions" value={overview.activeCompanions} hint={`${overview.companionsToday} created today`} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Questions today" value={overview.questionsToday} hint={`${overview.questionsThisMonth} this month`} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Active users (30d)" value={overview.activeUsers} hint={`${overview.newCustomersThisMonth} new workspaces`} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Storage" value={formatBytes(overview.storageBytes)} />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat
            label="Jobs today"
            value={overview.jobsToday}
            hint={`${formatPercent(overview.jobFailureRate, 1)} failed`}
            tone={overview.jobFailureRate > 0.1 ? 'bad' : 'default'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Failed payments"
            value={overview.failedPayments}
            tone={overview.failedPayments > 0 ? 'warn' : 'default'}
            hint="This month"
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Gross margin"
            value={
              overview.estimatedGrossMarginPercent === null
                ? '—'
                : `${overview.estimatedGrossMarginPercent}%`
            }
            hint="Revenue less AI spend"
            tone={
              overview.estimatedGrossMarginPercent !== null &&
              overview.estimatedGrossMarginPercent < 60
                ? 'warn'
                : 'good'
            }
          />
        </AdminCard>
        <AdminCard>
          <AdminStat label="ARPU" value={
            overview.activeSubscriptions > 0
              ? formatCurrencyCents(Math.round(overview.mrrCents / overview.activeSubscriptions))
              : '—'
          } hint="Per paying workspace" />
        </AdminCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Recent signups">
          <AdminTable
            head={['Workspace', 'Owner', 'Plan', 'When']}
            empty={signups.length === 0 ? 'No workspaces yet.' : undefined}
          >
            {signups.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.id}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{row.email}</td>
                <td className="px-3 py-2">
                  <AdminBadge tone={isFreePlan(row.planKey) ? 'neutral' : 'accent'}>
                    {row.planKey}
                  </AdminBadge>
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {formatRelativeTime(row.createdAt)}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Recent upgrades">
          <AdminTable
            head={['Workspace', 'Plan', 'MRR', 'When']}
            empty={upgrades.length === 0 ? 'No paid subscriptions yet.' : undefined}
          >
            {upgrades.map((row) => (
              <tr key={row.workspaceId}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <AdminBadge tone="accent">{row.planKey}</AdminBadge>
                </td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-ink)]">
                  {formatCurrencyCents(row.amountCents)}
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {formatRelativeTime(row.createdAt)}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Recent cancellations">
          <AdminTable
            head={['Workspace', 'Plan', 'Cancelled']}
            empty={cancellations.length === 0 ? 'No cancellations.' : undefined}
          >
            {cancellations.map((row) => (
              <tr key={row.workspaceId}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">{row.planKey}</td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {row.canceledAt ? formatRelativeTime(row.canceledAt) : '—'}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Failed payments">
          <AdminTable
            head={['Workspace', 'Amount', 'Attempts', 'When']}
            empty={failedPayments.length === 0 ? 'No failed payments.' : undefined}
          >
            {failedPayments.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2">
                  {row.workspaceId ? (
                    <Link
                      href={`/admin/customers/${row.workspaceId}`}
                      className="text-[color:var(--color-admin-ink)] hover:text-accent"
                    >
                      {row.name ?? 'Unknown'}
                    </Link>
                  ) : (
                    <span className="text-[color:var(--color-admin-muted)]">Unknown</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-danger">
                  {formatCurrencyCents(row.amountDueCents, row.currency)}
                </td>
                <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                  {row.attemptCount}
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {formatRelativeTime(row.occurredAt)}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      </div>

      <p className="mt-6 text-[11.5px] text-[color:var(--color-admin-muted)]">
        Month to date since {startOfUtcMonth().toISOString().slice(0, 10)}. Currency conversions for
        margin are indicative.
      </p>

    </AdminPage>
  );
}
