import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { billingEnabled } from '@/server/env';
import Link from 'next/link';
import { desc, eq, schema } from '@companion/db';
import { formatCurrencyCents, formatDateLong, formatRelativeTime } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { getCompanionSlots, getQuotaState } from '@/server/services/quota';
import { loadWorkspaceContext, quotaContextFor } from '@/server/services/workspace';
import { BillingActions } from '@/components/app/billing-actions';
import { UsageMeter } from '@/components/app/usage-meter';
import { Badge, Card, SectionHeading, Stat } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Billing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  // Nothing is for sale while Stripe is unconfigured, so this page does not
  // exist rather than showing prices that lead to a 503.
  if (!billingEnabled()) notFound();

  const auth = await requireAuth();
  const { checkout } = await searchParams;

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new Error('Workspace not found');

  const { db } = getContainer();
  const [quota, slots, invoices, adjustments] = await Promise.all([
    getQuotaState(quotaContextFor(workspace)),
    getCompanionSlots(workspace.id, workspace.entitlements),
    db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.workspaceId, workspace.id))
      .orderBy(desc(schema.payments.occurredAt))
      .limit(10),
    db
      .select()
      .from(schema.usageAdjustments)
      .where(eq(schema.usageAdjustments.workspaceId, workspace.id))
      .orderBy(desc(schema.usageAdjustments.createdAt))
      .limit(5),
  ]);

  const planName = workspace.planKey.charAt(0).toUpperCase() + workspace.planKey.slice(1);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
      <h1 className="text-[26px] tracking-[-0.03em] text-ink">Billing</h1>
      <p className="mt-1 text-[14px] text-ink-muted">
        Your plan, your usage and your invoices.
      </p>

      {checkout === 'success' ? (
        <div className="mt-6 rounded-[14px] bg-success-soft px-4 py-3 text-[13.5px] text-success">
          Your plan is active. It can take a moment for everything to update.
        </div>
      ) : null}

      <Card className="mt-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SectionHeading title={`${planName} plan`} description={planTagline(workspace.planKey)} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {workspace.subscription ? (
                <Badge tone={workspace.subscription.status === 'active' ? 'success' : 'warning'}>
                  {workspace.subscription.status.replace('_', ' ')}
                </Badge>
              ) : (
                <Badge>No subscription</Badge>
              )}
              {workspace.resolved.overridden ? (
                <Badge tone="accent">Plan granted by support</Badge>
              ) : null}
              {workspace.subscription?.cancelAtPeriodEnd ? (
                <Badge tone="warning">Cancels at period end</Badge>
              ) : null}
            </div>
            {workspace.subscription?.currentPeriodEnd ? (
              <p className="mt-2.5 text-[13px] text-ink-muted">
                {workspace.subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}{' '}
                {formatDateLong(workspace.subscription.currentPeriodEnd)}
              </p>
            ) : null}
          </div>
          <BillingActions hasSubscription={Boolean(workspace.subscription)} />
        </div>
      </Card>

      <Card className="mt-6">
        <SectionHeading
          title="This billing cycle"
          description={`${formatDateLong(quota.cycle.start)} — ${formatDateLong(quota.cycle.end)}`}
        />
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[12.5px] text-ink-muted">Questions</p>
            <UsageMeter
              used={quota.consumed}
              allowance={quota.effectiveAllowance}
              utilisation={quota.utilisation}
            />
          </div>
          <Stat
            label="Active Companions"
            value={slots.used}
            hint={slots.limit === null ? 'Unlimited (fair use)' : `of ${slots.limit}`}
          />
          <Stat
            label="Included each cycle"
            value={quota.planAllowance.toLocaleString()}
            hint={
              quota.adjustments !== 0
                ? `${quota.adjustments > 0 ? '+' : ''}${quota.adjustments.toLocaleString()} granted`
                : undefined
            }
          />
        </div>

        {adjustments.length > 0 ? (
          <div className="mt-6 rounded-[14px] bg-canvas p-4">
            <p className="text-[12.5px] font-[520] text-ink">Additional questions granted</p>
            <ul className="mt-2 space-y-1.5">
              {adjustments.map((adjustment) => (
                <li
                  key={adjustment.id}
                  className="flex items-center justify-between gap-3 text-[12.5px] text-ink-muted"
                >
                  <span>
                    {adjustment.amount > 0 ? '+' : ''}
                    {adjustment.amount.toLocaleString()} questions
                    {adjustment.recurring ? ' (each cycle)' : ''}
                  </span>
                  <span>{formatRelativeTime(adjustment.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card className="mt-6">
        <SectionHeading title="Invoices" />
        {invoices.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-ink-muted">
            No invoices yet. You are on the Free plan.{' '}
            <Link href="/pricing" className="text-accent hover:text-accent-hover">
              See plans
            </Link>
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-ink">
                    {formatCurrencyCents(invoice.amountPaidCents || invoice.amountDueCents, invoice.currency)}
                  </p>
                  <p className="text-[12px] text-ink-subtle">
                    {formatDateLong(invoice.occurredAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    tone={
                      invoice.status === 'paid'
                        ? 'success'
                        : invoice.status === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {invoice.status}
                  </Badge>
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-accent hover:text-accent-hover"
                    >
                      View
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function planTagline(planKey: string): string {
  switch (planKey) {
    case 'free':
      return 'Everything you need to share your first documents.';
    case 'personal':
      return 'For people who share documents every week.';
    case 'pro':
      return 'For teams sending proposals, decks and data rooms.';
    default:
      return 'For organisations sharing confidential material at scale.';
  }
}
