import { AppError, viewerVitalsSchema } from '@companion/shared';
import { schema } from '@companion/db';
import { noContent, parseJson, route } from '@/server/http';
import { getContainer } from '@/server/container';
import { getCompanionBySlug } from '@/server/services/companions';
import { readRecipientSession, requireAccess } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/**
 * Collects Core Web Vitals from the viewer.
 *
 * Field data, not a synthetic lab run: the question is what the recipient's
 * own device experienced. Nothing identifying is stored — a device class and a
 * number — and the beacon is fire-and-forget, so a failure here is invisible to
 * the reader.
 */
export const POST = route(async (request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const input = await parseJson(request, viewerVitalsSchema);

  const companion = await getCompanionBySlug(slug);
  if (!companion) throw new AppError('not_found', 'This document is no longer available.');

  // Vitals are still access-controlled: they name a Companion, so an
  // unauthorised caller must not be able to confirm one exists and is readable.
  const session = await readRecipientSession(companion);
  await requireAccess(companion, session);

  const { db, logger } = getContainer();
  const occurredAt = new Date();

  try {
    await db.insert(schema.viewerVitals).values(
      input.metrics.map((entry) => ({
        companionId: companion.id,
        workspaceId: companion.workspaceId,
        metric: entry.metric,
        value: entry.value,
        deviceClass: input.deviceClass ?? null,
        occurredAt,
      })),
    );
  } catch (error) {
    logger.warn('viewer vitals dropped', { companionId: companion.id, error });
  }

  return noContent();
});
