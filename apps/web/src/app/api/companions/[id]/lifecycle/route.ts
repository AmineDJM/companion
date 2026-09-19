import { AppError } from '@companion/shared';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import { applyLifecycle, deleteCompanion, requireOwnedCompanion } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['pause', 'reactivate', 'revoke', 'archive', 'unarchive', 'delete']),
});

export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = await parseJson(request, bodySchema);

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');
  const companion = await requireOwnedCompanion(id, workspace.id);

  if (input.action === 'delete') {
    await deleteCompanion({ companion, userId: auth.user.id });
    return json({ ok: true, deleted: true });
  }

  const updated = await applyLifecycle({
    companion,
    workspace,
    userId: auth.user.id,
    action: input.action,
  });
  return json({ ok: true, status: updated.effectiveStatus });
});
