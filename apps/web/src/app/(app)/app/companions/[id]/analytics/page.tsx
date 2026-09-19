import { notFound } from 'next/navigation';
import { analyticsAtLeast } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import {
  companionOverview,
  companionTopics,
  dailySeries,
  identifiedVisitors,
  mostConsultedFiles,
  mostViewedPages,
  unansweredQuestions,
} from '@/server/services/analytics';
import { getCompanionById } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { AnalyticsView } from '@/components/app/analytics-view';

export const dynamic = 'force-dynamic';

export default async function CompanionAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;

  const companion = await getCompanionById(id, auth.workspace.id);
  if (!companion) notFound();

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) notFound();

  const level = workspace.entitlements.analyticsLevel;
  const showPages = analyticsAtLeast(level, 'advanced');
  const showIdentities =
    workspace.entitlements.identifiedAccess && companion.accessMode !== 'PUBLIC';

  const [overview, topics, files, pages, unanswered, series, visitors] = await Promise.all([
    companionOverview(companion.id),
    companionTopics(companion.id, 8),
    mostConsultedFiles(companion.id, 6),
    showPages ? mostViewedPages(companion.id, 8) : Promise.resolve([]),
    unansweredQuestions(companion.id, 20),
    analyticsAtLeast(level, 'full') ? dailySeries(companion.id, 30) : Promise.resolve([]),
    showIdentities ? identifiedVisitors(companion.id, 50) : Promise.resolve([]),
  ]);

  return (
    <AnalyticsView
      level={level}
      overview={overview}
      topics={topics}
      files={files}
      pages={pages}
      unanswered={unanswered.map((question) => ({
        id: question.id,
        text: question.text,
        askedAt: question.askedAt.toISOString(),
        topicLabel: question.topicLabel,
      }))}
      series={series}
      visitors={visitors.map((visitor) => ({
        email: visitor.email,
        visitCount: visitor.visitCount,
        lastSeenAt: visitor.lastSeenAt.toISOString(),
      }))}
    />
  );
}
