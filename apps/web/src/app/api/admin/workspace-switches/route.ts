import { z } from 'zod';
import { json, parseJson, route } from '@/server/http';
import { setWorkspaceSwitches } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  uploadsDisabled: z.boolean().optional(),
  aiDisabled: z.boolean().optional(),
});

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, bodySchema);

  await setWorkspaceSwitches({
    workspaceId: input.workspaceId,
    adminUserId,
    adminLabel,
    ...(input.uploadsDisabled !== undefined ? { uploadsDisabled: input.uploadsDisabled } : {}),
    ...(input.aiDisabled !== undefined ? { aiDisabled: input.aiDisabled } : {}),
  });

  return json({ ok: true });
});
