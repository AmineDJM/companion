import { AppError, analyticsEventSchema } from '@companion/shared';
import { route, noContent } from '@/server/http';
import { parseJson } from '@/server/http';
import { recordAnalyticsEvent } from '@/server/services/analytics';
import { getCompanionBySlug } from '@/server/services/companions';
import { readRecipientSession, requireAccess } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/**
 * Records a viewer interaction. Deliberately tolerant: analytics must never
 * break the reading experience, so a rejected event returns 204 too.
 */
export const POST = route(async (request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const input = await parseJson(request, analyticsEventSchema);

  const companion = await getCompanionBySlug(slug);
  if (!companion) throw new AppError('not_found', 'This document is no longer available.');

  const session = await readRecipientSession(companion);
  await requireAccess(companion, session);

  await recordAnalyticsEvent({
    companionId: companion.id,
    workspaceId: companion.workspaceId,
    recipientSessionId: session?.id ?? null,
    type: input.type,
    fileId: input.fileId ?? null,
    page: input.page ?? null,
    durationMs: input.durationMs ?? null,
    metadata: input.metadata ?? null,
    // Scoped to the session so one viewer's id can never suppress another's
    // event, however the client generates it.
    idempotencyKey: input.eventId && session ? `${session.id}:${input.eventId}`.slice(0, 120) : null,
  });

  return noContent();
});
