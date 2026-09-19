import Link from 'next/link';
import { desc, eq, schema, sql } from '@companion/db';
import { formatCurrencyCents, formatDateLong } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { monthlyRecurringRevenueCents } from '@/server/services/billing';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminRevenuePage() {
  await requireSuperAdmin();
  const { db } = getContainer();

  const [mrrCents, subscriptions, byPlan, collected] = await Promise.all([
    monthlyRecurringRevenueCents(),
    db
      .select({
        id: schema.subscriptions.id,
        workspaceId: schema.subscriptions.workspaceId,
        workspaceName: schema.workspaces.name,
        ownerEmail: schema.users.email,
        planKey: schema.subscriptions.planKey,
        interval: schema.subscriptions.interval,
        status: schema.subscriptions.status,
        amountCents: schema.subscriptions.amountCents,
        currency: schema.subscriptions.currency,
        currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
        stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
        createdAt: schema.subscriptions.createdAt,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.subscriptions.workspaceId))
      .leftJoin(schema.users, eq(schema.users.id, schema.workspaces.ownerId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(100),
    db
      .select({
        planKey: schema.subscriptions.planKey,
        count: sql<number>`count(*)::int`,
        mrrCents: sql<number>`coalesce(sum(CASE WHEN ${schema.subscriptions.interval} = 'annual' THEN ${schema.subscriptions.amountCents} / 12.0 ELSE ${schema.subscriptions.amountCents} END), 0)::float8`,
      })
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.status} IN ('active','trialing')`)
      .groupBy(schema.subscriptions.planKey),
    db
      .select({
        value: sql<number>`coalesce(sum(${schema.payments.amountPaidCents}), 0)::int`,
      })
      .from(schema.payments)
      .where(eq(schema.payments.status, 'paid')),
  ]);

  const active = subscriptions.filter((row) => row.status === 'active').length;

  return (
    <AdminPage title="Subscriptions" description="Booked subscription value, distinct from collected cash.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat label="MRR (booked)" value={formatCurrencyCents(mrrCents)} tone="good" />
        </AdminCard>
        <AdminCard>
          <AdminStat label="ARR (booked)" value={formatCurrencyCents(mrrCents * 12)} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Active subscriptions" value={active} />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="Collected to date"
            value={formatCurrencyCents(collected[0]?.value ?? 0)}
            hint="Sum of paid invoices"
          />
        </AdminCard>
      </div>

      <AdminCard title="MRR by plan" className="mt-4">
        <AdminTable
          head={['Plan', 'Subscriptions', 'MRR']}
          empty={byPlan.length === 0 ? 'No paid subscriptions.' : undefined}
        >
          {byPlan.map((row) => (
            <tr key={row.planKey}>
              <td className="px-3 py-2">
                <AdminBadge tone="accent">{row.planKey}</AdminBadge>
              </td>
              <td className="px-3 py-2 tabular-nums">{row.count}</td>
              <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-ink)]">
                {formatCurrencyCents(Math.round(row.mrrCents))}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <AdminCard title="All subscriptions" className="mt-4">
        <AdminTable
          head={['Workspace', 'Owner', 'Plan', 'Status', 'MRR', 'Renews', 'Stripe id']}
          empty={subscriptions.length === 0 ? 'No subscriptions yet.' : undefined}
        >
          {subscriptions.map((row) => (
            <tr key={row.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="px-3 py-2">
                <Link
                  href={`/admin/customers/${row.workspaceId}`}
                  className="text-[color:var(--color-admin-ink)] hover:text-accent"
                >
                  {row.workspaceName}
                </Link>
              </td>
              <td className="max-w-[12rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                {row.ownerEmail ?? '—'}
              </td>
              <td className="px-3 py-2">
                <AdminBadge tone="accent">
                  {row.planKey} · {row.interval}
                </AdminBadge>
              </td>
              <td className="px-3 py-2">
                <AdminBadge
                  tone={
                    row.status === 'active'
                      ? 'good'
                      : row.status === 'past_due' || row.status === 'unpaid'
                        ? 'bad'
                        : 'neutral'
                  }
                >
                  {row.status}
                </AdminBadge>
                {row.cancelAtPeriodEnd ? <AdminBadge tone="warn">cancelling</AdminBadge> : null}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatCurrencyCents(
                  row.interval === 'annual' ? Math.round(row.amountCents / 12) : row.amountCents,
                  row.currency,
                )}
              </td>
              <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                {row.currentPeriodEnd ? formatDateLong(row.currentPeriodEnd) : '—'}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-[color:var(--color-admin-muted)]">
                {row.stripeSubscriptionId ?? '—'}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>

      <p className="mt-4 text-[11.5px] text-[color:var(--color-admin-muted)]">
        Stripe is the source of truth for money. This view is a synchronised mirror; where the two
        disagree, Stripe wins.
      </p>
    </AdminPage>
  );
}
