import { checkNumericConsistency } from './numbers.js';

/**
 * Deterministic groundedness classification.
 *
 * Each factual sentence of an answer is judged against the passages that were
 * actually cited. The judgement is lexical and numeric, not a model asking
 * itself whether it did well: content words must appear in the evidence, and
 * every figure must match. A model can be confidently wrong; an overlap
 * measurement cannot be confidently anything.
 */
export type ClaimSupport = 'SUPPORTED' | 'INFERRED' | 'UNSUPPORTED';

export interface ClaimAssessment {
  sentence: string;
  support: ClaimSupport;
  /** Share of the sentence's content words found in the evidence. */
  lexicalOverlap: number;
  numericallyConsistent: boolean;
  /** Content words that do not appear anywhere in the evidence. */
  missingTerms: string[];
}

export interface GroundednessReport {
  claims: ClaimAssessment[];
  supported: number;
  inferred: number;
  unsupported: number;
  /** Share of factual sentences with no support at all. */
  unsupportedRate: number;
}

/** Sentences that make no factual claim and therefore need no evidence. */
const NON_FACTUAL =
  /^(i (?:could not|couldn't|cannot|can't)|the (?:shared )?(?:material|documents?) (?:do(?:es)?n't|do not)|try asking|would you like|which (?:of|file)|let me know|i can (?:explain|summarise|summarize)|that information)/i;

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'before', 'being', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'each', 'either',
  'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'must', 'no',
  'not', 'of', 'on', 'one', 'only', 'or', 'other', 'per', 'shall', 'should', 'so', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'under',
  'until', 'upon', 'was', 'were', 'when', 'where', 'which', 'while', 'who', 'will', 'with',
  'within', 'would', 'you', 'your',
]);

/** Overlap at or above this counts as directly supported. */
const SUPPORTED_THRESHOLD = 0.6;
/** Between this and SUPPORTED_THRESHOLD counts as a reasonable inference. */
const INFERRED_THRESHOLD = 0.3;

export function assessGroundedness(answer: string, evidence: string): GroundednessReport {
  const sentences = splitSentences(answer).filter(
    (sentence) => sentence.length > 15 && !NON_FACTUAL.test(sentence),
  );

  const evidenceTerms = new Set(contentWords(evidence));
  const claims: ClaimAssessment[] = sentences.map((sentence) => {
    const terms = contentWords(sentence);
    const missingTerms = terms.filter((term) => !evidenceTerms.has(term));
    const lexicalOverlap = terms.length === 0 ? 1 : (terms.length - missingTerms.length) / terms.length;

    const numeric = checkNumericConsistency(sentence, evidence);
    const numericallyConsistent = numeric.mismatches.length === 0;

    // A figure the evidence does not contain makes the sentence unsupported
    // whatever its wording overlap.
    const support: ClaimSupport = !numericallyConsistent
      ? 'UNSUPPORTED'
      : lexicalOverlap >= SUPPORTED_THRESHOLD
        ? 'SUPPORTED'
        : lexicalOverlap >= INFERRED_THRESHOLD
          ? 'INFERRED'
          : 'UNSUPPORTED';

    return {
      sentence,
      support,
      lexicalOverlap: Number(lexicalOverlap.toFixed(3)),
      numericallyConsistent,
      missingTerms: missingTerms.slice(0, 12),
    };
  });

  const supported = claims.filter((claim) => claim.support === 'SUPPORTED').length;
  const inferred = claims.filter((claim) => claim.support === 'INFERRED').length;
  const unsupported = claims.filter((claim) => claim.support === 'UNSUPPORTED').length;

  return {
    claims,
    supported,
    inferred,
    unsupported,
    unsupportedRate: claims.length === 0 ? 0 : unsupported / claims.length,
  };
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    // Do not split on the dot inside a numbered clause such as "4.2".
    .split(/(?<![A-Z0-9])[.!?]+(?=\s+[A-Z“"']|\s*$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}%€$£]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Whether a reply is a refusal to answer rather than an answer.
 *
 * Used to measure false-answer and false-refusal rates against the golden
 * corpus; both are failures, in opposite directions.
 */
const REFUSAL_PATTERNS = [
  /couldn'?t find/i,
  /could not find/i,
  /not (?:contained|included|present|mentioned|covered) in/i,
  /(?:does|do) not (?:contain|include|mention|cover|specify)/i,
  /no information (?:about|on|regarding)/i,
  /isn'?t (?:in|covered)/i,
  /can'?t reproduce/i,
];

export function isRefusal(answer: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(answer));
}
