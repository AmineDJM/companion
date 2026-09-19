import { AppError, unlockSchema } from '@companion/shared';
import { headers } from 'next/headers';
import { hashClientIp } from '@/server/auth/session';
import { json, parseJson, route, NO_STORE_HEADERS } from '@/server/http';
import { getCompanionBySlug } from '@/server/services/companions';
import { recordAnalyticsEvent } from '@/server/services/analytics';
import {
  ensureRecipientSession,
  verifyCompanionPassword,
} from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/** Verifies the share password. Rate limited per Companion and per network. */
export const POST = route(async (request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const input = await parseJson(request, unlockSchema);
  if (!input.password) throw new AppError('validation_failed', 'Enter the password.');

  const companion = await getCompanionBySlug(slug);
  if (!companion) throw new AppError('not_found', 'This document is no longer available.');

  const session = await ensureRecipientSession(companion);
  const requestHeaders = await headers();

  const valid = await verifyCompanionPassword({
    companion,
    session,
    password: input.password,
    ipHash: hashClientIp(requestHeaders),
  });

  await recordAnalyticsEvent({
    companionId: companion.id,
    workspaceId: companion.workspaceId,
    recipientSessionId: session.id,
    type: valid ? 'password_success' : 'password_failure',
  });

  if (!valid) throw new AppError('password_incorrect', 'Incorrect password.');
  return json({ ok: true }, { headers: NO_STORE_HEADERS });
});
