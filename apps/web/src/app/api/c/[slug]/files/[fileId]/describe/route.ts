import { AppError, evaluateRecipientAccess } from '@companion/shared';
import { json, route, NO_STORE_HEADERS } from '@/server/http';
import { getCompanionBySlug, loadAccessState } from '@/server/services/companions';
import { describePreview } from '@/server/services/previews';
import { credentialsOf, readRecipientSession } from '@/server/services/recipient-session';

export const runtime = 'nodejs';

/** Tells the viewer how to render a file when the reader switches documents. */
export const GET = route(
  async (_request, context: { params: Promise<{ slug: string; fileId: string }> }) => {
    const { slug, fileId } = await context.params;

    const companion = await getCompanionBySlug(slug);
    if (!companion) throw new AppError('not_found', 'This document is no longer available.');

    const session = await readRecipientSession(companion);
    const state = await loadAccessState(companion);
    const decision = evaluateRecipientAccess(state, credentialsOf(session));
    if (!decision.allowed) throw new AppError(decision.code, decision.message);

    const preview = await describePreview({ companion, fileId });
    return json({ preview }, { headers: NO_STORE_HEADERS });
  },
);
