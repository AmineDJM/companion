import { passwordSchema } from '@companion/shared';
import { z } from 'zod';
import { changePassword } from '@/server/auth/accounts';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  currentPassword: z.string().max(200).default(''),
  newPassword: passwordSchema,
});

export const POST = route(async (request) => {
  const auth = await requireAuth();
  const input = await parseJson(request, bodySchema);
  await changePassword(auth.user.id, input.currentPassword, input.newPassword);
  return json({ ok: true });
});
