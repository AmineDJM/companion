import { adminWorkspaceStatusSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { setWorkspaceStatus } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminWorkspaceStatusSchema);

  await setWorkspaceStatus({
    workspaceId: input.workspaceId,
    adminUserId,
    adminLabel,
    status: input.status,
    reason: input.reason,
  });

  return json({ ok: true });
});
