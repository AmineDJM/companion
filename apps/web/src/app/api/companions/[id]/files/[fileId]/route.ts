import { AppError } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, route } from '@/server/http';
import { requireOwnedCompanion } from '@/server/services/companions';
import { getFile, queueFileProcessing, removeFile, storeFileVersion } from '@/server/services/files';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Replaces a document with a new version.
 *
 * The public share link is untouched: recipients keep the URL they already
 * have and immediately see the new content. Only the affected file is
 * re-indexed.
 */
export const PUT = route(
  async (request, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const auth = await requireAuth();
    const { id, fileId } = await context.params;

    const workspace = await loadWorkspaceContext(auth.workspace.id);
    if (!workspace) throw new AppError('not_found', 'Workspace not found.');
    if (!workspace.entitlements.replaceDocuments) {
      throw new AppError(
        'entitlement_required',
        'Replacing documents without changing the link is available on the Pro plan.',
        { details: { entitlement: 'replaceDocuments' } },
      );
    }

    const companion = await requireOwnedCompanion(id, workspace.id);
    const existing = await getFile(fileId, companion.id);
    if (!existing) throw new AppError('not_found', 'File not found.');

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('validation_failed', 'No file was received.');

    const bytes = Buffer.from(await file.arrayBuffer());
    const previousVersionId = existing.currentVersionId;

    const updated = await storeFileVersion({
      companion,
      workspaceId: workspace.id,
      userId: auth.user.id,
      filename: file.name,
      relativePath: existing.path,
      bytes,
      existingFileId: existing.id,
    });

    if (updated.currentVersionId) {
      await queueFileProcessing({
        companionId: companion.id,
        workspaceId: workspace.id,
        fileId: updated.id,
        fileVersionId: updated.currentVersionId,
        kind: updated.kind,
        previousVersionId,
      });
    }

    await recordAudit({
      action: AUDIT_ACTIONS.fileReplaced,
      actorType: 'user',
      actorUserId: auth.user.id,
      workspaceId: workspace.id,
      targetType: 'file',
      targetId: updated.id,
      targetLabel: updated.name,
      metadata: { version: updated.versionCount, previousFilename: existing.name },
    });

    return json({ ok: true, fileId: updated.id, version: updated.versionCount });
  },
);

export const DELETE = route(
  async (_request, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const auth = await requireAuth();
    const { id, fileId } = await context.params;
    const companion = await requireOwnedCompanion(id, auth.workspace.id);
    const file = await getFile(fileId, companion.id);
    if (!file) throw new AppError('not_found', 'File not found.');

    await removeFile({ companion, file, userId: auth.user.id });
    return json({ ok: true });
  },
);
