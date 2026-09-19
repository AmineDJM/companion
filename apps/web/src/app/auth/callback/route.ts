import { NextResponse } from 'next/server';
import { completeMagicLink } from '@/server/auth/accounts';
import { appUrl } from '@/server/env';
import { getContainer } from '@/server/container';
import { claimDraft } from '@/server/services/drafts';
import { eq, schema } from '@companion/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Magic-link landing. Consumes the single-use token, signs the visitor in and
 * adopts any upload draft they started before creating an account.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get('token');
  const base = appUrl();

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', base));
  }

  try {
    const result = await completeMagicLink(token);
    let destination = '/app/companions';

    const draftToken = result.payload?.['draftToken'];
    if (draftToken) {
      const { db } = getContainer();
      const rows = await db
        .select({ workspaceId: schema.workspaceMembers.workspaceId })
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.userId, result.userId))
        .limit(1);
      const workspaceId = rows[0]?.workspaceId;
      if (workspaceId) {
        const claimed = await claimDraft({
          token: draftToken,
          workspaceId,
          userId: result.userId,
        });
        if (claimed) destination = `/app/companions/${claimed.companionId}`;
      }
    }

    return NextResponse.redirect(new URL(destination, base));
  } catch {
    return NextResponse.redirect(new URL('/login?error=expired_link', base));
  }
}
