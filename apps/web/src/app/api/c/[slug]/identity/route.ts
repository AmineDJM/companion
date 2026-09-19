import { AppError, emailSchema } from '@companion/shared';
import { z } from 'zod';
import { json, parseJson, route, NO_STORE_HEADERS } from '@/server/http';
import { getCompanionBySlug } from '@/server/services/companions';
import { recordAnalyticsEvent } from '@/server/services/analytics';
import { recipientCodeEmail, sendEmail } from '@/server/services/email';
import { getContainer } from '@/server/container';
import { isDevelopment } from '@/server/env';
import {
  confirmIdentity,
  ensureRecipientSession,
  startIdentityVerification,
} from '@/server/services/recipient-session';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('request'), email: emailSchema }),
  z.object({ step: z.literal('confirm'), email: emailSchema, code: z.string().trim().length(6) }),
]);

/**
 * Passwordless recipient identity.
 *
 * Only used when the sender required it. The UI states plainly that the sender
 * will see who opened the document — recipients are never silently identified.
 */
export const POST = route(async (request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const input = await parseJson(request, bodySchema);

  const companion = await getCompanionBySlug(slug);
  if (!companion) throw new AppError('not_found', 'This document is no longer available.');
  const session = await ensureRecipientSession(companion);

  if (input.step === 'request') {
    const { code } = await startIdentityVerification({ companion, email: input.email });
    const message = recipientCodeEmail({
      code,
      companionName: companion.name,
      senderLabel: companion.branding.senderLabel,
    });
    await sendEmail({ ...message, to: input.email });
    if (isDevelopment()) {
      getContainer().logger.info('recipient code issued', { slug, code });
    }
    return json({ ok: true, sent: true }, { headers: NO_STORE_HEADERS });
  }

  const confirmed = await confirmIdentity({
    companion,
    session,
    email: input.email,
    code: input.code,
  });
  if (!confirmed) throw new AppError('password_incorrect', 'That code is not correct.');

  await recordAnalyticsEvent({
    companionId: companion.id,
    workspaceId: companion.workspaceId,
    recipientSessionId: session.id,
    type: 'identity_verified',
  });

  return json({ ok: true, verified: true }, { headers: NO_STORE_HEADERS });
});
