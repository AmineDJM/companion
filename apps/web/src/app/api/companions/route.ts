import { companionFiltersSchema, createCompanionSchema } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, parseQuery, route } from '@/server/http';
import { createCompanion, listCompanions } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { AppError } from '@companion/shared';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const auth = await requireAuth();
  const input = await parseJson(request, createCompanionSchema);

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');
  if (workspace.uploadsDisabled) {
    throw new AppError('forbidden', 'Uploads are disabled for this workspace. Contact support.');
  }

  const companion = await createCompanion({
    workspace,
    userId: auth.user.id,
    ...(input.name ? { name: input.name } : {}),
  });

  return json({ companionId: companion.id, slug: companion.slug, name: companion.name });
});

export const GET = route(async (request) => {
  const auth = await requireAuth();
  const filters = parseQuery(request, companionFiltersSchema);
  const result = await listCompanions(auth.workspace.id, filters);
  return json({
    items: result.items.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      status: item.effectiveStatus,
      fileCount: item.fileCount,
      viewCount: item.viewCount,
      questionCount: item.questionCount,
      expiresAt: item.expiresAt,
      updatedAt: item.updatedAt,
    })),
    total: result.total,
  });
});
