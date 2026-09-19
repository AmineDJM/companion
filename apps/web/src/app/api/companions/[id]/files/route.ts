import { AppError, describeFile, ERROR_CODES, type ErrorCode } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, route } from '@/server/http';
import { addFilesToCompanion, listFiles } from '@/server/services/files';
import { requireOwnedCompanion } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Accepts one file per request.
 *
 * Per-file rather than per-batch so a 400 MB upload streams with real progress
 * and one failure never invalidates the rest of the batch.
 */
export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');
  if (workspace.uploadsDisabled) {
    throw new AppError('forbidden', 'Uploads are disabled for this workspace.');
  }

  const companion = await requireOwnedCompanion(id, workspace.id);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('validation_failed', 'No file was received.');

  const relativePath = String(form.get('relativePath') ?? file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const info = describeFile(file.name);

  const result = await addFilesToCompanion({
    companion,
    workspace,
    userId: auth.user.id,
    files: [
      {
        filename: file.name,
        bytes,
        contentType: file.type || info.mimeType,
        relativePath,
      },
    ],
  });

  const rejection = result.rejected[0];
  if (rejection && result.added.length === 0) {
    // Surface the real reason so the sender knows which file failed and why.
    const code = (ERROR_CODES as readonly string[]).includes(rejection.code)
      ? (rejection.code as ErrorCode)
      : 'unsupported_file';
    throw new AppError(code, rejection.message);
  }

  const added = result.added[0];
  return json({
    ok: true,
    file: added ? { id: added.id, name: added.name, status: added.status } : null,
  });
});

export const GET = route(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const companion = await requireOwnedCompanion(id, auth.workspace.id);
  const files = await listFiles(companion.id);
  return json({
    items: files.map((file) => ({
      id: file.id,
      name: file.name,
      path: file.path,
      kind: file.kind,
      status: file.status,
      statusMessage: file.statusMessage,
      sizeBytes: file.sizeBytes,
      pageCount: file.pageCount,
      versionCount: file.versionCount,
      isContainer: file.isContainer,
    })),
  });
});
