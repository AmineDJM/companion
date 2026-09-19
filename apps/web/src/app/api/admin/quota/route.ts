import { adminQuotaAdjustmentSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { adjustQuota } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminQuotaAdjustmentSchema);

  await adjustQuota({
    workspaceId: input.workspaceId,
    adminUserId,
    adminLabel,
    type: input.type,
    amount: input.amount,
    reason: input.reason,
    expiresAt: input.expiresAt ?? null,
    recurring: input.recurring,
  });

  return json({ ok: true });
});
