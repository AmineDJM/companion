import type { Metadata } from 'next';
import Link from 'next/link';
import {
  companionFiltersSchema,
  expiresSoon,
  formatCompactNumber,
  formatRelativeTime,
} from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { listCompanions, workspaceCompanionSummary } from '@/server/services/companions';
import { getCompanionSlots, getQuotaState } from '@/server/services/quota';
import { loadWorkspaceContext, quotaContextFor } from '@/server/services/workspace';
import { CompanionList } from '@/components/app/companion-list';
import { UsageMeter } from '@/components/app/usage-meter';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Stat, StatRow } from '@/components/ui/primitives';
import { PlusIcon } from '@/components/ui/icons';

export const metadata: Metadata = {
  title: 'My Companions',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CompanionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const auth = await requireAuth();
  const raw = await searchParams;
  const filters = companionFiltersSchema.parse({
    q: raw['q'],
    status: raw['status'],
    sort: raw['sort'] ?? 'updated',
    page: raw['page'] ?? '1',
  });

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new Error('Workspace not found');

  const [list, summary, quota, slots] = await Promise.all([
    listCompanions(workspace.id, filters),
    workspaceCompanionSummary(workspace.id),
    getQuotaState(quotaContextFor(workspace)),
    getCompanionSlots(workspace.id, workspace.entitlements),
  ]);

  const isFiltered = Boolean(filters.q) || Boolean(filters.status);
  const hasAny = list.total > 0 || isFiltered;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] tracking-[-0.03em] text-ink">My Companions</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Everything you&rsquo;ve shared, controlled from one place.
          </p>
        </div>
        <ButtonLink href="/app/companions/new" icon={<PlusIcon size={16} />}>
          Create Companion
        </ButtonLink>
      </div>

      <section aria-label="Summary" className="card mt-7 p-6">
        <StatRow>
          <Stat
            label="Active Companions"
            value={summary.active}
            hint={slots.limit === null ? 'Unlimited' : `of ${slots.limit}`}
          />
          <Stat label="Views this month" value={formatCompactNumber(summary.viewsThisMonth)} />
          <Stat
            label="Questions this month"
            value={formatCompactNumber(summary.questionsThisMonth)}
          />
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink-muted">Usage</p>
            <UsageMeter
              used={quota.consumed}
              allowance={quota.effectiveAllowance}
              utilisation={quota.utilisation}
            />
          </div>
        </StatRow>
      </section>

      {hasAny ? (
        <CompanionList
          items={list.items.map((item) => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            status: item.effectiveStatus,
            fileCount: item.fileCount,
            viewCount: item.viewCount,
            questionCount: item.questionCount,
            unansweredCount: item.unansweredCount,
            downloadAllowed: item.downloadAllowed,
            accessMode: item.accessMode,
            expiresAt: item.expiresAt?.toISOString() ?? null,
            expiresSoon: expiresSoon(item.expiresAt),
            updatedLabel: formatRelativeTime(item.updatedAt),
          }))}
          total={list.total}
          filters={{ q: filters.q ?? '', status: filters.status ?? '', sort: filters.sort }}
          page={filters.page}
        />
      ) : (
        <div className="mt-7">
          <EmptyState
            title="Create your first Companion"
            description="Drop a document, a folder or a ZIP. We turn it into one intelligent link you stay in control of."
            action={
              <ButtonLink href="/app/companions/new" icon={<PlusIcon size={16} />}>
                Create Companion
              </ButtonLink>
            }
          />
          <p className="mt-4 text-center text-[13px] text-ink-muted">
            Not sure what to share?{' '}
            <Link href="/security" className="text-accent hover:text-accent-hover">
              See how Companion protects your documents
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
