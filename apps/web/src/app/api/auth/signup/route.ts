import { AppError, signupSchema } from '@companion/shared';
import { headers } from 'next/headers';
import { applySuperAdminBootstrap, createAccount } from '@/server/auth/accounts';
import { createSession, hashClientIp } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import { checkRateLimit } from '@/server/services/rate-limit';
import { claimDraft } from '@/server/services/drafts';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const input = await parseJson(request, signupSchema);
  const requestHeaders = await headers();
  const ipHash = hashClientIp(requestHeaders);

  const limit = await checkRateLimit({
    key: `signup:${ipHash ?? 'unknown'}`,
    windowSeconds: 3_600,
    max: 20,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many sign-ups from this network. Try again later.');
  }

  const account = await createAccount({
    email: input.email,
    password: input.password,
    ...(input.name ? { name: input.name } : {}),
  });
  await applySuperAdminBootstrap(input.email, account.userId);
  await createSession(account.userId);

  // An upload started before signing up is adopted rather than re-uploaded.
  const claimed = input.draftToken
    ? await claimDraft({
        token: input.draftToken,
        workspaceId: account.workspaceId,
        userId: account.userId,
      })
    : null;

  return json({
    ok: true,
    redirectTo: claimed ? `/app/companions/${claimed.companionId}` : '/app/companions',
  });
});
