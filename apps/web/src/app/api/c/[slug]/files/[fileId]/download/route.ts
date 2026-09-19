import { AppError, evaluateDownloadAccess } from '@companion/shared';
import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { getContainer } from '@/server/container';
import { recordAnalyticsEvent } from '@/server/services/analytics';
import { getCompanionBySlug, loadAccessState } from '@/server/services/companions';
import { resolveArtifact } from '@/server/services/previews';
import { credentialsOf, readRecipientSession } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/**
 * Downloads the original file.
 *
 * Only reachable when the sender enabled downloads — and the check runs here,
 * on every request, so turning downloads off closes this endpoint instantly for
 * links that are already open.
 */
export const GET = route(
  async (_request, context: { params: Promise<{ slug: string; fileId: string }> }) => {
    const { slug, fileId } = await context.params;
    const { storage } = getContainer();

    const companion = await getCompanionBySlug(slug);
    if (!companion) throw new AppError('not_found', 'This document is no longer available.');

    const session = await readRecipientSession(companion);
    const state = await loadAccessState(companion);
    const decision = evaluateDownloadAccess(state, credentialsOf(session));
    if (!decision.allowed) {
      if (session) {
        await recordAnalyticsEvent({
          companionId: companion.id,
          workspaceId: companion.workspaceId,
          recipientSessionId: session.id,
          type: 'access_denied',
          fileId,
          metadata: { reason: decision.code },
        });
      }
      throw new AppError(decision.code, decision.message);
    }

    const artifact = await resolveArtifact({
      companionId: companion.id,
      fileId,
      page: null,
      original: true,
    });

    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: companion.workspaceId,
      recipientSessionId: session?.id ?? null,
      type: 'download_clicked',
      fileId,
    });

    // A short-lived signed URL keeps the large-file transfer off the app server,
    // and expires long before it could be shared usefully.
    if (storage.name === 's3') {
      const url = await storage.signedDownloadUrl(artifact.storageKey, {
        expiresIn: 120,
        downloadFilename: artifact.filename,
      });
      return NextResponse.redirect(url, { status: 302 });
    }

    const bytes = await storage.get(artifact.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  },
);
