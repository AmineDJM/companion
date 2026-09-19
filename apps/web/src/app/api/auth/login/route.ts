import { loginSchema } from '@companion/shared';
import { eq, schema } from '@companion/db';
import { headers } from 'next/headers';
import { signInWithPassword } from '@/server/auth/accounts';
import { hashClientIp } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { json, parseJson, route } from '@/server/http';
import { claimDraft } from '@/server/services/drafts';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const input = await parseJson(request, loginSchema);
  const requestHeaders = await headers();

  const userId = await signInWithPassword({
    email: input.email,
    password: input.password,
    ipHash: hashClientIp(requestHeaders),
  });

  let redirectTo = '/app/companions';
  if (input.draftToken) {
    const workspaceId = await firstWorkspaceId(userId);
    if (workspaceId) {
      const claimed = await claimDraft({ token: input.draftToken, workspaceId, userId });
      if (claimed) redirectTo = `/app/companions/${claimed.companionId}`;
    }
  }

  return json({ ok: true, redirectTo });
});

async function firstWorkspaceId(userId: string): Promise<string | null> {
  const { db } = getContainer();
  const rows = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaceMembers.createdAt)
    .limit(1);
  return rows[0]?.id ?? null;
}
