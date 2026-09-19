import { AppError, adminCompanionActionSchema } from '@companion/shared';
import { eq, schema } from '@companion/db';
import { json, parseJson, route } from '@/server/http';
import { getContainer } from '@/server/container';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/audit';
import { applyLifecycle, getCompanionById } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { queueFileProcessing, listFiles, getCurrentVersion } from '@/server/services/files';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

/**
 * Operational actions on any Companion.
 *
 * Deliberately limited to lifecycle and reprocessing — an operator can restore
 * service without ever being handed the customer's document content.
 */
export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminCompanionActionSchema);
  const { db } = getContainer();

  const companion = await getCompanionById(input.companionId);
  if (!companion) throw new AppError('not_found', 'Companion not found.');

  const workspace = await loadWorkspaceContext(companion.workspaceId);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');

  switch (input.action) {
    case 'pause':
    case 'reactivate':
    case 'revoke':
      await applyLifecycle({
        companion,
        workspace,
        userId: adminUserId,
        action: input.action,
        actorType: 'admin',
      });
      break;

    case 'force_expire':
      await db
        .update(schema.companions)
        .set({ status: 'EXPIRED', expiresAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.companions.id, companion.id));
      break;

    case 'reprocess': {
      // Re-queues every current file version. The pipeline replaces its own
      // output, so a reprocess never duplicates units or chunks.
      const files = await listFiles(companion.id);
      let queued = 0;
      for (const file of files) {
        const version = await getCurrentVersion(file.id);
        if (!version) continue;
        const jobId = await queueFileProcessing({
          companionId: companion.id,
          workspaceId: companion.workspaceId,
          fileId: file.id,
          fileVersionId: version.id,
          kind: file.kind,
        });
        if (jobId) queued += 1;
      }
      await db
        .update(schema.companions)
        .set({ status: 'PROCESSING', processingProgress: 5, updatedAt: new Date() })
        .where(eq(schema.companions.id, companion.id));

      await recordAudit({
        action: AUDIT_ACTIONS.adminCompanionAction,
        actorType: 'admin',
        actorUserId: adminUserId,
        actorLabel: adminLabel,
        workspaceId: companion.workspaceId,
        targetType: 'companion',
        targetId: companion.id,
        metadata: { action: 'reprocess', queued, reason: input.reason },
      });
      return json({ ok: true, queued });
    }
  }

  await recordAudit({
    action: AUDIT_ACTIONS.adminCompanionAction,
    actorType: 'admin',
    actorUserId: adminUserId,
    actorLabel: adminLabel,
    workspaceId: companion.workspaceId,
    targetType: 'companion',
    targetId: companion.id,
    targetLabel: companion.name,
    metadata: { action: input.action, reason: input.reason },
  });

  return json({ ok: true });
});
