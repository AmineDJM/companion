import Link from 'next/link';
import { desc, eq, schema } from '@companion/db';
import { formatCurrencyCents, formatDateTime, formatRelativeTime } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminBadge, AdminCard, AdminPage, AdminTable } from '@/components/admin/shell';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const { db } = getContainer();

  const rows = await db
    .select({
      id: schema.payments.id,
      workspaceId: schema.payments.workspaceId,
      workspaceName: schema.workspaces.name,
      amountDueCents: schema.payments.amountDueCents,
      amountPaidCents: schema.payments.amountPaidCents,
      currency: schema.payments.currency,
      status: schema.payments.status,
      attemptCount: schema.payments.attemptCount,
      failureMessage: schema.payments.failureMessage,
      nextRetryAt: schema.payments.nextRetryAt,
      hostedInvoiceUrl: schema.payments.hostedInvoiceUrl,
      stripeInvoiceId: schema.payments.stripeInvoiceId,
      occurredAt: schema.payments.occurredAt,
    })
    .from(schema.payments)
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.payments.workspaceId))
    .where(params.status ? eq(schema.payments.status, params.status as never) : undefined)
    .orderBy(desc(schema.payments.occurredAt))
    .limit(100);

  const failed = rows.filter((row) => row.status === 'failed');

  return (
    <AdminPage title="Payments" description="Invoices synchronised from Stripe.">
      <nav className="mb-4 flex gap-1.5" aria-label="Filter payments">
        {['', 'paid', 'failed', 'open', 'refunded'].map((status) => (
          <Link
            key={status || 'all'}
            href={status ? `/admin/payments?status=${status}` : '/admin/payments'}
            className={`rounded-[8px] border px-2.5 py-1 text-[12.5px] transition-colors ${
              (params.status ?? '') === status
                ? 'border-accent text-accent'
                : 'border-[color:var(--admin-line)] text-[color:var(--color-admin-muted)] hover:text-[color:var(--color-admin-ink)]'
            }`}
          >
            {status || 'all'}
          </Link>
        ))}
      </nav>

      {failed.length > 0 && !params.status ? (
        <AdminCard title="Failed payments needing attention" className="mb-4">
          <AdminTable head={['Workspace', 'Amount', 'Attempts', 'Reason', 'Next retry']}>
            {failed.slice(0, 10).map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2">
                  {row.workspaceId ? (
                    <Link
                      href={`/admin/customers/${row.workspaceId}`}
                      className="text-[color:var(--color-admin-ink)] hover:text-accent"
                    >
                      {row.workspaceName ?? 'Unknown'}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-danger">
                  {formatCurrencyCents(row.amountDueCents, row.currency)}
                </td>
                <td className="px-3 py-2 tabular-nums">{row.attemptCount}</td>
                <td className="max-w-[18rem] truncate px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {row.failureMessage ?? '—'}
                </td>
                <td className="px-3 py-2 text-[color:var(--color-admin-muted)]">
                  {row.nextRetryAt ? formatRelativeTime(row.nextRetryAt) : '—'}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      ) : null}

      <AdminCard>
        <AdminTable
          head={['Date', 'Workspace', 'Amount', 'Status', 'Invoice', '']}
          empty={rows.length === 0 ? 'No payments recorded.' : undefined}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[color:var(--color-admin-elevated)]/40">
              <td className="whitespace-nowrap px-3 py-2 text-[color:var(--color-admin-muted)]">
                {formatDateTime(row.occurredAt)}
              </td>
              <td className="px-3 py-2">
                {row.workspaceId ? (
                  <Link
                    href={`/admin/customers/${row.workspaceId}`}
                    className="text-[color:var(--color-admin-ink)] hover:text-accent"
                  >
                    {row.workspaceName ?? 'Unknown'}
                  </Link>
                ) : (
                  <span className="text-[color:var(--color-admin-muted)]">—</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatCurrencyCents(row.amountPaidCents || row.amountDueCents, row.currency)}
              </td>
              <td className="px-3 py-2">
                <AdminBadge
                  tone={row.status === 'paid' ? 'good' : row.status === 'failed' ? 'bad' : 'neutral'}
                >
                  {row.status}
                </AdminBadge>
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-[color:var(--color-admin-muted)]">
                {row.stripeInvoiceId ?? '—'}
              </td>
              <td className="px-3 py-2">
                {row.hostedInvoiceUrl ? (
                  <a
                    href={row.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-accent hover:underline"
                  >
                    Open
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminCard>
    </AdminPage>
  );
}
