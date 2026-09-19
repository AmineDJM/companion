import { adminFeatureFlagSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { setFeatureFlag } from '@/server/services/admin-ops';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const PUT = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminFeatureFlagSchema);

  await setFeatureFlag({
    key: input.key,
    adminUserId,
    adminLabel,
    ...(input.description !== undefined ? { description: input.description } : {}),
    enabledGlobally: input.enabledGlobally,
    enabledPlans: input.enabledPlans,
    enabledWorkspaceIds: input.enabledWorkspaceIds,
  });

  return json({ ok: true });
});
