import { AppError, evaluateRecipientAccess } from '@companion/shared';
import { route } from '@/server/http';
import { getContainer } from '@/server/container';
import { getCompanionBySlug, loadAccessState } from '@/server/services/companions';
import { resolveArtifact } from '@/server/services/previews';
import { credentialsOf, readRecipientSession } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/**
 * Streams one rendered page image.
 *
 * This is the path used when downloads are disabled: the reader sees pictures
 * of pages, so the source document is never handed to the browser at all.
 */
export const GET = route(
  async (
    _request,
    context: { params: Promise<{ slug: string; fileId: string; page: string }> },
  ) => {
    const { slug, fileId, page } = await context.params;
    const pageNumber = Number.parseInt(page, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10_000) {
      throw new AppError('validation_failed', 'Invalid page.');
    }

    const { storage } = getContainer();
    const companion = await getCompanionBySlug(slug);
    if (!companion) throw new AppError('not_found', 'This document is no longer available.');

    const session = await readRecipientSession(companion);
    const state = await loadAccessState(companion);
    const decision = evaluateRecipientAccess(state, credentialsOf(session));
    if (!decision.allowed) throw new AppError(decision.code, decision.message);

    const artifact = await resolveArtifact({
      companionId: companion.id,
      fileId,
      page: pageNumber,
      original: false,
    });

    const bytes = await storage.get(artifact.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(bytes.byteLength),
        'content-disposition': 'inline',
        // Page images are immutable per version, but must stay out of shared caches.
        'cache-control': 'private, max-age=3600, no-store',
        'x-robots-tag': 'noindex, nofollow',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
