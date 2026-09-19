import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatBytes,
  formatCurrencyCents,
  formatDateLong,
  formatDateTime,
  formatRelativeTime,
  formatUsd,
  isFreePlan,
} from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { workspaceDetail } from '@/server/services/admin';
import { AdminBadge, AdminCard, AdminPage, AdminStat, AdminTable } from '@/components/admin/shell';
import { CustomerActions } from '@/components/admin/customer-actions';

export const dynamic = 'force-dynamic';

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const detail = await workspaceDetail(id).catch(() => null);
  if (!detail) notFound();

  const { workspace, members, subscription, payments, adjustments, companions, usage, notes, jobs, audits, entitlements, quota, cycle } =
    detail;

  return (
    <AdminPage
      title={workspace.name}
      description={`Workspace ${workspace.id}`}
      actions={
        <div className="flex items-center gap-2">
          {workspace.status === 'suspended' ? <AdminBadge tone="bad">Suspended</AdminBadge> : null}
          {workspace.uploadsDisabled ? <AdminBadge tone="warn">Uploads off</AdminBadge> : null}
          {workspace.aiDisabled ? <AdminBadge tone="warn">AI off</AdminBadge> : null}
          <AdminBadge tone={isFreePlan(workspace.planKey) ? 'neutral' : 'accent'}>
            {entitlements.planKey}
            {entitlements.overridden ? ' (override)' : ''}
          </AdminBadge>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminCard>
          <AdminStat
            label="Questions this cycle"
            value={`${quota.consumed.toLocaleString()} / ${quota.effectiveAllowance.toLocaleString()}`}
            hint={`${quota.remaining.toLocaleString()} remaining`}
            tone={quota.exhausted ? 'bad' : quota.utilisation > 0.85 ? 'warn' : 'default'}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat
            label="AI cost this month"
            value={formatUsd(usage?.costUsd ?? 0, 4)}
            hint={`${usage?.errors ?? 0} provider errors`}
          />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Companions" value={companions.length} />
        </AdminCard>
        <AdminCard>
          <AdminStat label="Storage" value={formatBytes(workspace.storageBytesUsed)} />
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <AdminCard title="Quota breakdown">
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label="Plan allowance" value={quota.planAllowance.toLocaleString()} />
              <Figure label="Purchased" value={quota.purchased.toLocaleString()} />
              <Figure
                label="Admin bonus"
                value={`${quota.adjustments >= 0 ? '+' : ''}${quota.adjustments.toLocaleString()}`}
              />
              <Figure label="Consumed" value={quota.consumed.toLocaleString()} />
            </dl>
            <p className="mt-3 text-[11.5px] text-[color:var(--color-admin-muted)]">
              Cycle {formatDateLong(cycle.start)} — {formatDateLong(cycle.end)}. Effective allowance{' '}
              {quota.effectiveAllowance.toLocaleString()}.
            </p>
          </AdminCard>

          <AdminCard title="Subscription">
            {subscription ? (
              <dl className="grid gap-3 text-[12.5px] sm:grid-cols-3">
                <Figure label="Status" value={subscription.status} />
                <Figure label="Plan" value={`${subscription.planKey} (${subscription.interval})`} />
                <Figure label="Amount" value={formatCurrencyCents(subscription.amountCents, subscription.currency)} />
                <Figure
                  label="Renews"
                  value={
                    subscription.currentPeriodEnd
                      ? formatDateLong(subscription.currentPeriodEnd)
                      : '—'
                  }
                />
                <Figure label="Stripe subscription" value={subscription.stripeSubscriptionId ?? '—'} mono />
                <Figure label="Stripe customer" value={workspace.stripeCustomerId ?? '—'} mono />
              </dl>
            ) : (
              <p className="text-[12.5px] text-[color:var(--color-admin-muted)]">
                No subscription — this workspace is on the Free plan.
              </p>
            )}
          </AdminCard>

          <AdminCard title="Companions">
            <AdminTable
              head={['Name', 'Slug', 'Status', 'Files', 'Views', 'Questions', 'Created']}
              empty={companions.length === 0 ? 'No Companions.' : undefined}
            >
              {companions.slice(0, 20).map((companion) => (
                <tr key={companion.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/companions/${companion.id}`}
                      className="text-[color:var(--color-admin-ink)] hover:text-accent"
                    >
                      {companion.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {companion.slug}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge tone={companion.status === 'ACTIVE' ? 'good' : 'neutral'}>
                      {companion.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{companion.fileCount}</td>
                  <td className="px-3 py-2 tabular-nums">{companion.viewCount}</td>
                  <td className="px-3 py-2 tabular-nums">{companion.questionCount}</td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatRelativeTime(companion.createdAt)}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>

          <AdminCard title="Recent payments">
            <AdminTable
              head={['Date', 'Amount', 'Status', 'Attempts', 'Invoice']}
              empty={payments.length === 0 ? 'No payments.' : undefined}
            >
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatDateLong(payment.occurredAt)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatCurrencyCents(payment.amountPaidCents || payment.amountDueCents, payment.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge
                      tone={
                        payment.status === 'paid' ? 'good' : payment.status === 'failed' ? 'bad' : 'neutral'
                      }
                    >
                      {payment.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{payment.attemptCount}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[color:var(--color-admin-muted)]">
                    {payment.stripeInvoiceId ?? '—'}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>

          <AdminCard title="Quota adjustment history">
            <AdminTable
              head={['When', 'Amount', 'Type', 'Reason', 'Expires']}
              empty={adjustments.length === 0 ? 'No adjustments granted.' : undefined}
            >
              {adjustments.map((adjustment) => (
                <tr key={adjustment.id}>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatDateTime(adjustment.createdAt)}
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums ${adjustment.amount > 0 ? 'text-success' : 'text-danger'}`}
                  >
                    {adjustment.amount > 0 ? '+' : ''}
                    {adjustment.amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge>{adjustment.type}</AdminBadge>
                    {adjustment.recurring ? <AdminBadge tone="accent">recurring</AdminBadge> : null}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {adjustment.reason}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {adjustment.expiresAt ? formatDateLong(adjustment.expiresAt) : 'never'}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>

          <AdminCard title="Recent jobs">
            <AdminTable
              head={['Type', 'Status', 'Duration', 'Error', 'When']}
              empty={jobs.length === 0 ? 'No jobs.' : undefined}
            >
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2 font-mono text-[11.5px]">{job.type}</td>
                  <td className="px-3 py-2">
                    <AdminBadge
                      tone={
                        job.status === 'COMPLETED' ? 'good' : job.status === 'FAILED' ? 'bad' : 'neutral'
                      }
                    >
                      {job.status}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[color:var(--color-admin-muted)]">
                    {job.durationMs ? `${Math.round(job.durationMs)}ms` : '—'}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-danger/80">
                    {job.error ?? ''}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatRelativeTime(job.createdAt)}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>

          <AdminCard title="Audit history">
            <AdminTable
              head={['When', 'Actor', 'Action', 'Target']}
              empty={audits.length === 0 ? 'No recorded actions.' : undefined}
            >
              {audits.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge tone={entry.actorType === 'admin' ? 'accent' : 'neutral'}>
                      {entry.actorType}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px]">{entry.action}</td>
                  <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                    {entry.targetLabel ?? entry.targetType ?? '—'}
                  </td>
                </tr>
              ))}
            </AdminTable>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <CustomerActions
            workspaceId={workspace.id}
            status={workspace.status}
            planKey={entitlements.planKey}
            uploadsDisabled={workspace.uploadsDisabled}
            aiDisabled={workspace.aiDisabled}
          />

          <AdminCard title="Members">
            <ul className="space-y-2.5">
              {members.map((member) => (
                <li key={member.userId}>
                  <p className="truncate text-[12.5px] text-[color:var(--color-admin-ink)]">
                    {member.email}
                  </p>
                  <p className="text-[11.5px] text-[color:var(--color-admin-muted)]">
                    {member.role}
                    {member.lastSeenAt ? ` · seen ${formatRelativeTime(member.lastSeenAt)}` : ''}
                    {member.suspendedAt ? ' · suspended' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </AdminCard>

          <AdminCard title="Internal notes">
            {notes.length === 0 ? (
              <p className="text-[12px] text-[color:var(--color-admin-muted)]">
                No notes. These are never visible to the customer.
              </p>
            ) : (
              <ul className="space-y-3">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-accent/40 pl-2.5">
                    <p className="text-[12.5px] leading-snug text-[color:var(--color-admin-ink)]">
                      {note.body}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[color:var(--color-admin-muted)]">
                      {note.authorLabel ?? 'admin'} · {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>
    </AdminPage>
  );
}

function Figure({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[color:var(--color-admin-muted)]">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-[13px] text-[color:var(--color-admin-ink)] ${mono ? 'font-mono text-[11.5px]' : 'tabular-nums'}`}
      >
        {value}
      </dd>
    </div>
  );
}
