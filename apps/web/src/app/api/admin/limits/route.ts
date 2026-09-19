import { platformLimitsSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { updatePlatformLimits } from '@/server/services/admin-ops';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const PATCH = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const limits = await parseJson(request, platformLimitsSchema);
  await updatePlatformLimits({ adminUserId, adminLabel, limits });
  return json({ ok: true });
});
