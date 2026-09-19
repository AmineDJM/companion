import { AppError, evaluateRecipientAccess } from '@companion/shared';
import { route } from '@/server/http';
import { getContainer } from '@/server/container';
import { getCompanionBySlug, loadAccessState } from '@/server/services/companions';
import { resolveArtifact } from '@/server/services/previews';
import { credentialsOf, readRecipientSession } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/**
 * Streams a preview artifact.
 *
 * Access is evaluated on every single request. The bytes are proxied by this
 * route — the browser never learns the storage key, and no presigned URL to the
 * original file is ever minted while downloads are disabled.
 */
export const GET = route(
  async (_request, context: { params: Promise<{ slug: string; fileId: string }> }) => {
    const { slug, fileId } = await context.params;
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
      page: null,
      original: false,
    });

    const bytes = await storage.get(artifact.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(bytes.byteLength),
        // inline, never attachment: this endpoint is for reading, not saving.
        'content-disposition': 'inline',
        'cache-control': 'private, no-store, max-age=0',
        'x-robots-tag': 'noindex, nofollow',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
