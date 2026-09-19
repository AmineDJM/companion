import { requireAuth } from '@/server/auth/session';
import { json, route } from '@/server/http';
import { requireOwnedCompanion } from '@/server/services/companions';
import { listFiles } from '@/server/services/files';

export const runtime = 'nodejs';

/**
 * Processing progress for the build screen. Polled by the client so the sender
 * can leave the page and come back to a finished Companion.
 */
export const GET = route(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const companion = await requireOwnedCompanion(id, auth.workspace.id);
  const files = await listFiles(companion.id);

  const failed = files.filter((file) => file.status === 'FAILED' || file.status === 'UNSUPPORTED');

  return json({
    status: companion.effectiveStatus,
    progress: companion.processingProgress,
    step: companion.processingStep,
    error: companion.processingError,
    slug: companion.slug,
    fileCount: companion.fileCount,
    indexedChunks: companion.indexedChunks,
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      status: file.status,
      statusMessage: file.statusMessage,
    })),
    failures: failed.map((file) => ({ name: file.name, message: file.statusMessage })),
  });
});
