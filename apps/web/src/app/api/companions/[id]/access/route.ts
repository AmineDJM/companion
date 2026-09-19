import { AppError, accessPolicyInputSchema } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import { requireOwnedCompanion, updateAccess } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';

export const runtime = 'nodejs';

export const PATCH = route(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = await parseJson(request, accessPolicyInputSchema);

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');

  const companion = await requireOwnedCompanion(id, workspace.id);
  const updated = await updateAccess({
    companion,
    workspace,
    userId: auth.user.id,
    update: {
      accessMode: input.accessMode,
      ...(input.password !== undefined ? { password: input.password } : {}),
      ...(input.allowedEmails ? { allowedEmails: input.allowedEmails } : {}),
      ...(input.allowedDomains ? { allowedDomains: input.allowedDomains } : {}),
      ...(input.expirationPreset ? { expirationPreset: input.expirationPreset } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.downloadAllowed !== undefined ? { downloadAllowed: input.downloadAllowed } : {}),
      ...(input.sourceProtectionMode ? { sourceProtectionMode: input.sourceProtectionMode } : {}),
      ...(input.aiEnabled !== undefined ? { aiEnabled: input.aiEnabled } : {}),
    },
  });

  return json({
    ok: true,
    accessMode: updated.accessMode,
    downloadAllowed: updated.downloadAllowed,
    expiresAt: updated.expiresAt,
    status: updated.effectiveStatus,
  });
});
