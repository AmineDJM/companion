import { AppError, askQuestionSchema } from '@companion/shared';
import { json, parseJson, route, NO_STORE_HEADERS } from '@/server/http';
import { ask } from '@/server/services/ask';
import { getCompanionBySlug } from '@/server/services/companions';
import {
  credentialsOf,
  ensureRecipientSession,
  readRecipientSession,
} from '@/server/services/recipient-session';
import { loadAccessState } from '@/server/services/companions';
import { evaluateAskAccess } from '@companion/shared';
import { loadWorkspaceContext, quotaContextFor } from '@/server/services/workspace';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Asks a question about the shared material.
 *
 * Access is re-checked here, not inherited from the page load: a Companion
 * revoked while the viewer is open must stop answering immediately.
 */
export const POST = route(async (request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const input = await parseJson(request, askQuestionSchema);

  const companion = await getCompanionBySlug(slug);
  if (!companion) throw new AppError('not_found', 'This document is no longer available.');

  const existing = await readRecipientSession(companion);
  const state = await loadAccessState(companion);
  const decision = evaluateAskAccess(state, credentialsOf(existing));
  if (!decision.allowed) throw new AppError(decision.code, decision.message);

  const session = existing ?? (await ensureRecipientSession(companion));
  const workspace = await loadWorkspaceContext(companion.workspaceId);
  if (!workspace) throw new AppError('not_found', 'This document is no longer available.');
  if (workspace.aiDisabled) {
    throw new AppError('forbidden', 'Questions are turned off for this document.');
  }

  const result = await ask({
    companion,
    session,
    quotaContext: quotaContextFor(workspace),
    question: input.question,
    conversationId: input.conversationId ?? null,
    context: {
      fileId: input.context?.fileId ?? null,
      page: input.context?.page ?? null,
      sheet: input.context?.sheet ?? null,
      slide: input.context?.slide ?? null,
      selection: input.context?.selection ?? null,
    },
    senderLabel: companion.branding.senderLabel ?? workspace.name,
    signal: request.signal,
  });

  return json(
    {
      questionId: result.questionId,
      conversationId: result.conversationId,
      answer: result.answer,
      answered: result.answered,
      citations: result.citations.map((citation) => ({
        id: citation.id,
        fileId: citation.fileId,
        fileName: citation.fileName,
        page: citation.page,
        slide: citation.slide,
        sheet: citation.sheet,
        range: citation.range,
        quote: citation.quote,
        label: citation.label,
      })),
    },
    { headers: NO_STORE_HEADERS },
  );
});
