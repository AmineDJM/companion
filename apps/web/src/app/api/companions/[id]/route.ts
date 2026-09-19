import { AppError, updateCompanionSchema } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import {
  renameCompanion,
  requireOwnedCompanion,
  setDefaultFile,
  updateBranding,
} from '@/server/services/companions';
import { getFile } from '@/server/services/files';
import { loadWorkspaceContext } from '@/server/services/workspace';

export const runtime = 'nodejs';

export const PATCH = route(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = await parseJson(request, updateCompanionSchema);

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');
  let companion = await requireOwnedCompanion(id, workspace.id);

  if (input.name) {
    companion = await renameCompanion({ companion, userId: auth.user.id, name: input.name });
  }

  if (input.defaultFileId !== undefined) {
    if (input.defaultFileId !== null) {
      const file = await getFile(input.defaultFileId, companion.id);
      if (!file) throw new AppError('not_found', 'That file is not part of this Companion.');
      if (file.isContainer) {
        throw new AppError('validation_failed', 'An archive cannot be the document recipients open.');
      }
    }
    await setDefaultFile(companion.id, input.defaultFileId);
  }

  if (input.branding) {
    companion = await updateBranding({
      companion,
      workspace,
      userId: auth.user.id,
      branding: input.branding,
    });
  }

  return json({ ok: true, name: companion.name });
});

export const GET = route(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const companion = await requireOwnedCompanion(id, auth.workspace.id);
  return json({
    id: companion.id,
    name: companion.name,
    slug: companion.slug,
    status: companion.effectiveStatus,
    downloadAllowed: companion.downloadAllowed,
    accessMode: companion.accessMode,
    expiresAt: companion.expiresAt,
    fileCount: companion.fileCount,
    viewCount: companion.viewCount,
    questionCount: companion.questionCount,
  });
});
