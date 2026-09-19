import { adminNoteSchema } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { addWorkspaceNote } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, adminNoteSchema);
  await addWorkspaceNote({
    workspaceId: input.workspaceId,
    adminUserId,
    adminLabel,
    body: input.body,
  });
  return json({ ok: true });
});
