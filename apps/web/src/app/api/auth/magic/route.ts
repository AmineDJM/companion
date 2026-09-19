import { AppError, magicLinkRequestSchema } from '@companion/shared';
import { headers } from 'next/headers';
import { findUserByEmail, issueAuthToken } from '@/server/auth/accounts';
import { hashClientIp } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { appUrl, isDevelopment } from '@/server/env';
import { json, parseJson, route } from '@/server/http';
import { sendEmail } from '@/server/services/email';
import { checkRateLimit } from '@/server/services/rate-limit';

export const runtime = 'nodejs';

/**
 * Requests a magic link. The response is identical whether or not the address
 * has an account, so this endpoint cannot be used to enumerate users.
 */
export const POST = route(async (request) => {
  const input = await parseJson(request, magicLinkRequestSchema);
  const requestHeaders = await headers();
  const ipHash = hashClientIp(requestHeaders);

  const limit = await checkRateLimit({
    key: `magic:${input.email}:${ipHash ?? 'unknown'}`,
    windowSeconds: 900,
    max: 5,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many requests. Try again in a few minutes.');
  }

  const user = await findUserByEmail(input.email);
  const token = await issueAuthToken({
    email: input.email,
    purpose: 'magic_link',
    userId: user?.id ?? null,
    ...(input.draftToken ? { payload: { draftToken: input.draftToken } } : {}),
  });

  const link = `${appUrl()}/auth/callback?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: input.email,
    subject: 'Your Companion sign-in link',
    text: `Open this link to sign in to Companion. It expires in 15 minutes.\n\n${link}\n\nIf you did not request it, you can ignore this email.`,
  });

  const { logger } = getContainer();
  if (isDevelopment()) logger.info('magic link issued', { link });

  return json({ ok: true });
});
