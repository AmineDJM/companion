import { json, route } from '@/server/http';
import { runGoldenCorpus } from '@/server/services/evaluation';
import { recordAudit } from '@/server/services/audit';
import { adminContext } from '../../_guard';

export const runtime = 'nodejs';
/** Retrieval over the whole corpus takes longer than a default serverless slot. */
export const maxDuration = 300;

export const POST = route(async () => {
  const { adminUserId, adminLabel } = await adminContext();
  const report = await runGoldenCorpus({ triggeredByUserId: adminUserId });

  await recordAudit({
    actorUserId: adminUserId,
    actorLabel: adminLabel,
    actorType: 'admin',
    action: 'quality.evaluation_run',
    targetType: 'quality_run',
    targetId: report.runId,
    metadata: {
      cases: report.cases,
      recallAt5: report.recallAt5,
      blockingFailures: report.blockingFailures,
    },
  });

  return json(report);
});
