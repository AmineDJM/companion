import {
  assessGroundedness,
  checkNumericConsistency,
  isRefusal,
  type ClaimAssessment,
} from '@companion/quality';
import type { ResolvedCitation } from '@companion/shared';
import { measure } from './quality';

/**
 * Answer verification.
 *
 * Every answer is checked against the exact passages that were put in front of
 * the model: citation ids must resolve, quotes must appear verbatim, every
 * material figure must exist in the evidence, and every factual sentence must
 * have lexical support. All of it is arithmetic and string comparison — the
 * model is never asked whether its own answer looks right, because an answer
 * that is confidently wrong is exactly the case where it would say yes.
 *
 * Measurement never changes what the recipient sees. Enforcement has already
 * happened upstream: an invented citation was dropped and an unverifiable
 * quote was discarded before this runs. What is recorded here is how often
 * that enforcement had to act.
 */
export interface AnswerVerification {
  citationValidity: number;
  quoteFidelity: number;
  numericConsistency: number;
  unsupportedRate: number;
  unsupportedClaims: ClaimAssessment[];
}

export interface AnswerVerificationInput {
  workspaceId: string;
  companionId: string;
  questionId: string;
  answer: string;
  answered: boolean;
  /** Source ids the model claimed, before invalid ones were dropped. */
  claimedSourceIds: string[];
  /** Source ids that actually existed in the retrieved set. */
  validSourceIds: Set<string>;
  /** Quotes the model produced, and whether each survived verbatim checking. */
  quotes: { verified: boolean }[];
  citations: ResolvedCitation[];
  /** The concatenated passage text the model was given. */
  evidence: string;
}

export async function verifyAnswer(input: AnswerVerificationInput): Promise<AnswerVerification> {
  const context = { workspaceId: input.workspaceId, companionId: input.companionId };

  // A refusal makes no claims, so grounding it would only measure the wording
  // of the refusal itself.
  const refused = !input.answered || isRefusal(input.answer);

  const claimed = input.claimedSourceIds.length;
  const resolved = input.claimedSourceIds.filter((id) => input.validSourceIds.has(id)).length;
  const citationValidity = claimed === 0 ? 1 : resolved / claimed;

  const quoteCount = input.quotes.length;
  const quoteFidelity =
    quoteCount === 0 ? 1 : input.quotes.filter((quote) => quote.verified).length / quoteCount;

  const numeric = refused
    ? { consistency: 1, mismatches: [] as ReturnType<typeof checkNumericConsistency>['mismatches'] }
    : checkNumericConsistency(input.answer, input.evidence);

  const grounded = refused
    ? { unsupportedRate: 0, claims: [] as ClaimAssessment[], supported: 0, inferred: 0, unsupported: 0 }
    : assessGroundedness(input.answer, input.evidence);

  const base = {
    questionId: input.questionId,
    citationCount: input.citations.length,
    evidenceCharacters: input.evidence.length,
  };

  await Promise.all([
    measure(
      'answer.citation_validity',
      {
        value: citationValidity,
        sampleSize: claimed,
        evidence: {
          ...base,
          claimedSourceIds: claimed,
          resolvedSourceIds: resolved,
          // The ids themselves, so a fabrication can be seen rather than counted.
          fabricated: input.claimedSourceIds.filter((id) => !input.validSourceIds.has(id)),
        },
      },
      context,
    ),
    measure(
      'answer.quote_fidelity',
      {
        value: quoteFidelity,
        sampleSize: quoteCount,
        evidence: {
          ...base,
          quotesOffered: quoteCount,
          quotesVerified: quoteCount === 0 ? 0 : Math.round(quoteFidelity * quoteCount),
        },
      },
      context,
    ),
    measure(
      'answer.numeric_consistency',
      {
        value: numeric.consistency,
        sampleSize: refused ? 0 : numeric.mismatches.length + Math.round(numeric.consistency * 10),
        evidence: {
          ...base,
          mismatches: numeric.mismatches.slice(0, 5).map((mismatch) => ({
            reason: mismatch.reason,
            ratio: mismatch.ratio,
            stated: mismatch.answerNumber.value,
            nearestInEvidence: mismatch.nearest?.value ?? null,
          })),
        },
      },
      context,
    ),
    measure(
      'answer.unsupported_claim_rate',
      {
        value: grounded.unsupportedRate,
        sampleSize: grounded.claims.length,
        evidence: {
          ...base,
          supported: grounded.supported,
          inferred: grounded.inferred,
          unsupported: grounded.unsupported,
          // Truncated: this is diagnostic evidence, not a copy of the answer.
          examples: grounded.claims
            .filter((claim) => claim.support === 'UNSUPPORTED')
            .slice(0, 3)
            .map((claim) => ({
              sentence: claim.sentence.slice(0, 160),
              lexicalOverlap: claim.lexicalOverlap,
              missingTerms: claim.missingTerms,
            })),
        },
      },
      context,
    ),
  ]);

  return {
    citationValidity,
    quoteFidelity,
    numericConsistency: numeric.consistency,
    unsupportedRate: grounded.unsupportedRate,
    unsupportedClaims: grounded.claims.filter((claim) => claim.support === 'UNSUPPORTED'),
  };
}

/**
 * Source reconstruction.
 *
 * Protection is only real if it is measured against what actually left the
 * server. This compares the verbatim text a session has received against the
 * size of the document it was received from, which is the ratio that decides
 * whether a determined reader could rebuild the source through questions.
 */
export async function measureSourceExposure(input: {
  workspaceId: string;
  companionId: string;
  sessionId: string;
  quotedCharactersTotal: number;
  documentCharacters: number;
  mode: string;
}): Promise<void> {
  if (input.documentCharacters <= 0) return;
  await measure(
    'security.source_reconstruction_ratio',
    {
      value: input.quotedCharactersTotal / input.documentCharacters,
      sampleSize: 1,
      evidence: {
        // No document text: a ratio is enough to act on.
        sessionId: input.sessionId,
        protectionMode: input.mode,
        quotedCharacters: input.quotedCharactersTotal,
        documentCharacters: input.documentCharacters,
      },
    },
    { workspaceId: input.workspaceId, companionId: input.companionId },
  );
}
