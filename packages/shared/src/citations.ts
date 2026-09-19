import { z } from 'zod';

/**
 * Structured answer contract.
 *
 * The model is handed a closed set of source ids taken from retrieval and may
 * only cite those. The server re-resolves every id against the database before
 * anything reaches the recipient, so a hallucinated id becomes a dropped
 * citation rather than a fake reference.
 */
export const modelCitationSchema = z.object({
  source_id: z.string().min(1).max(64),
  quote: z.string().max(4_000).optional().nullable(),
  relevance: z.number().min(0).max(1).optional().nullable(),
});

export const modelAnswerSchema = z.object({
  answer: z.string().min(1).max(12_000),
  citations: z.array(modelCitationSchema).max(12).default([]),
  answered: z.boolean(),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
export type ModelCitation = z.infer<typeof modelCitationSchema>;

/** A citation after the server has resolved it to real, currently-served content. */
export interface ResolvedCitation {
  id: string;
  fileId: string;
  fileName: string;
  fileVersionId: string;
  unitId: string | null;
  chunkId: string;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  /** e.g. "B12:F20" for a spreadsheet region. */
  range: string | null;
  sectionTitle: string | null;
  quote: string | null;
  relevance: number;
  /** Pre-rendered label: "Draft Contract · page 11". */
  label: string;
}

export function citationLabel(input: {
  fileName: string;
  page?: number | null;
  slide?: number | null;
  sheet?: string | null;
  range?: string | null;
  sectionTitle?: string | null;
}): string {
  const parts: string[] = [input.fileName];
  if (input.sheet) {
    parts.push(`${input.sheet} sheet`);
    if (input.range) parts.push(input.range);
  } else if (input.slide != null) {
    parts.push(`slide ${input.slide}`);
  } else if (input.page != null) {
    parts.push(`page ${input.page}`);
  } else if (input.sectionTitle) {
    parts.push(input.sectionTitle);
  }
  return parts.join(' · ');
}

export const NO_ANSWER_TEXT = "I couldn't find that information in the shared material.";

/**
 * Validates and filters model citations against the ids actually supplied to
 * the model. Invalid ids are dropped silently — they are a model error, not a
 * recipient error — and duplicates collapse to the highest relevance.
 */
export function sanitiseCitations(
  citations: ModelCitation[],
  validSourceIds: Set<string>,
): ModelCitation[] {
  const bySource = new Map<string, ModelCitation>();
  for (const citation of citations) {
    if (!validSourceIds.has(citation.source_id)) continue;
    const existing = bySource.get(citation.source_id);
    if (!existing || (citation.relevance ?? 0) > (existing.relevance ?? 0)) {
      bySource.set(citation.source_id, citation);
    }
  }
  return [...bySource.values()].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
}

/**
 * A model may claim `answered: true` while citing nothing. When retrieval found
 * sources but the answer references none of them, we treat it as unanswered so
 * the recipient is never shown an ungrounded claim.
 */
export function isGroundedAnswer(answer: ModelAnswer, resolvedCitationCount: number): boolean {
  if (!answer.answered) return false;
  if (resolvedCitationCount > 0) return true;
  // Short procedural replies (clarifying questions, refusals) need no citation.
  return answer.answer.length < 240;
}
