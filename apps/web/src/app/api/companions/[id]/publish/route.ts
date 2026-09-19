import { AppError } from '@companion/shared';
import { eq, schema } from '@companion/db';
import { requireAuth } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { json, route } from '@/server/http';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/audit';
import { requireOwnedCompanion, setDefaultFile } from '@/server/services/companions';
import { listFiles } from '@/server/services/files';

export const runtime = 'nodejs';

/**
 * Moves a draft Companion into processing and gives it a live share link.
 *
 * The link is valid the moment this returns: recipients see a "still being
 * prepared" state until indexing finishes, rather than a broken URL.
 */
export const POST = route(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const { db } = getContainer();

  const companion = await requireOwnedCompanion(id, auth.workspace.id);
  const files = await listFiles(companion.id);
  const rendered = files.filter((file) => !file.isContainer);

  if (rendered.length === 0 && files.length === 0) {
    throw new AppError('validation_failed', 'Add at least one file before attaching a Companion.');
  }

  // Pick the first non-archive file as the document the recipient opens.
  if (!companion.defaultFileId && rendered[0]) {
    await setDefaultFile(companion.id, rendered[0].id);
  }

  const stillProcessing = files.some(
    (file) => file.status === 'QUEUED' || file.status === 'PROCESSING' || file.status === 'PENDING',
  );

  await db
    .update(schema.companions)
    .set({
      status: stillProcessing ? 'PROCESSING' : 'ACTIVE',
      publishedAt: companion.publishedAt ?? new Date(),
      processingStep: stillProcessing ? 'reading' : null,
      processingProgress: stillProcessing ? 5 : 100,
      updatedAt: new Date(),
    })
    .where(eq(schema.companions.id, companion.id));

  await recordAudit({
    action: AUDIT_ACTIONS.companionPublished,
    actorType: 'user',
    actorUserId: auth.user.id,
    workspaceId: auth.workspace.id,
    targetType: 'companion',
    targetId: companion.id,
    targetLabel: companion.name,
    metadata: { fileCount: files.length },
  });

  return json({ ok: true, slug: companion.slug, processing: stillProcessing });
});
