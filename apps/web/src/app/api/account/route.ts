import { z } from 'zod';
import { eq, schema } from '@companion/db';
import { requireAuth } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { json, parseJson, route } from '@/server/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  name: z.string().trim().max(120).optional(),
  workspaceName: z.string().trim().min(1).max(160).optional(),
});

export const PATCH = route(async (request) => {
  const auth = await requireAuth();
  const input = await parseJson(request, bodySchema);
  const { db } = getContainer();

  if (input.name !== undefined) {
    await db
      .update(schema.users)
      .set({ name: input.name || null, updatedAt: new Date() })
      .where(eq(schema.users.id, auth.user.id));
  }

  if (input.workspaceName && (auth.workspace.role === 'owner' || auth.workspace.role === 'admin')) {
    await db
      .update(schema.workspaces)
      .set({ name: input.workspaceName, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, auth.workspace.id));
  }

  return json({ ok: true });
});
