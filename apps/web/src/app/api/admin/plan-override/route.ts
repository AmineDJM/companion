import { adminPlanChangeSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { overridePlan } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminPlanChangeSchema);

  await overridePlan({
    workspaceId: input.workspaceId,
    adminUserId,
    adminLabel,
    planKey: input.planKey,
    reason: input.reason,
    expiresAt: input.expiresAt ?? null,
  });

  return json({ ok: true });
});
