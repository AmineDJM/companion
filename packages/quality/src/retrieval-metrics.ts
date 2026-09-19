/**
 * Information-retrieval metrics over the golden corpus.
 *
 * Standard definitions, implemented here so a retrieval change is judged by
 * the same arithmetic every time rather than by how the results look.
 */
export interface RetrievedResult {
  fileId: string;
  /** Page, slide or sheet ordinal, when the expectation is that precise. */
  unitOrdinal?: number | null;
  unitId?: string | null;
}

export interface ExpectedEvidence {
  fileId: string;
  unitOrdinal?: number | null;
  unitId?: string | null;
}

/** A retrieved result matches when it is the expected unit, or the expected file when no unit was specified. */
export function matches(result: RetrievedResult, expected: ExpectedEvidence): boolean {
  if (result.fileId !== expected.fileId) return false;
  if (expected.unitId) return result.unitId === expected.unitId;
  if (expected.unitOrdinal != null) return result.unitOrdinal === expected.unitOrdinal;
  return true;
}

/** 1-based rank of the first matching result, or null when none matched. */
export function firstMatchRank(
  results: RetrievedResult[],
  expected: ExpectedEvidence[],
): number | null {
  for (const [index, result] of results.entries()) {
    if (expected.some((entry) => matches(result, entry))) return index + 1;
  }
  return null;
}

export function recallAtK(
  results: RetrievedResult[],
  expected: ExpectedEvidence[],
  k: number,
): number {
  if (expected.length === 0) return 1;
  const window = results.slice(0, k);
  const found = expected.filter((entry) => window.some((result) => matches(result, entry)));
  return found.length / expected.length;
}

/** Whether any expected evidence appears in the first k results. */
export function hitAtK(results: RetrievedResult[], expected: ExpectedEvidence[], k: number): boolean {
  const rank = firstMatchRank(results.slice(0, k), expected);
  return rank !== null;
}

export function precisionAtK(
  results: RetrievedResult[],
  expected: ExpectedEvidence[],
  k: number,
): number {
  if (k === 0) return 0;
  const window = results.slice(0, k);
  const relevant = window.filter((result) => expected.some((entry) => matches(result, entry)));
  return relevant.length / k;
}

export function reciprocalRank(results: RetrievedResult[], expected: ExpectedEvidence[]): number {
  const rank = firstMatchRank(results, expected);
  return rank === null ? 0 : 1 / rank;
}

/**
 * nDCG with binary relevance and the standard log2 position discount.
 * Normalised by the ideal ordering, so it is comparable across questions with
 * different numbers of relevant passages.
 */
export function ndcgAtK(
  results: RetrievedResult[],
  expected: ExpectedEvidence[],
  k: number,
): number {
  if (expected.length === 0) return 1;

  const gains: number[] = results
    .slice(0, k)
    .map((result) => (expected.some((entry) => matches(result, entry)) ? 1 : 0));
  const dcg = gains.reduce((total, gain, index) => total + gain / Math.log2(index + 2), 0);

  const idealCount = Math.min(expected.length, k);
  const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2)).reduce(
    (total, value) => total + value,
    0,
  );

  return idcg === 0 ? 1 : dcg / idcg;
}

export interface CorpusOutcome {
  questionId: string;
  answerable: boolean;
  results: RetrievedResult[];
  expected: ExpectedEvidence[];
  category?: string;
}

export interface RetrievalReport {
  sampleSize: number;
  recallAt1: number;
  recallAt5: number;
  precisionAt5: number;
  mrr: number;
  ndcgAt5: number;
  /** Per-category breakdown, e.g. by document type or question kind. */
  byCategory: Record<string, { sampleSize: number; recallAt5: number; mrr: number }>;
  misses: string[];
}

export function summariseRetrieval(outcomes: CorpusOutcome[]): RetrievalReport {
  const answerable = outcomes.filter((outcome) => outcome.answerable);
  if (answerable.length === 0) {
    return {
      sampleSize: 0,
      recallAt1: 1,
      recallAt5: 1,
      precisionAt5: 1,
      mrr: 1,
      ndcgAt5: 1,
      byCategory: {},
      misses: [],
    };
  }

  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

  const report: RetrievalReport = {
    sampleSize: answerable.length,
    recallAt1: mean(answerable.map((o) => (hitAtK(o.results, o.expected, 1) ? 1 : 0))),
    recallAt5: mean(answerable.map((o) => (hitAtK(o.results, o.expected, 5) ? 1 : 0))),
    precisionAt5: mean(answerable.map((o) => precisionAtK(o.results, o.expected, 5))),
    mrr: mean(answerable.map((o) => reciprocalRank(o.results, o.expected))),
    ndcgAt5: mean(answerable.map((o) => ndcgAtK(o.results, o.expected, 5))),
    byCategory: {},
    misses: answerable
      .filter((o) => !hitAtK(o.results, o.expected, 5))
      .map((o) => o.questionId),
  };

  const categories = new Map<string, CorpusOutcome[]>();
  for (const outcome of answerable) {
    const key = outcome.category ?? 'uncategorised';
    categories.set(key, [...(categories.get(key) ?? []), outcome]);
  }
  for (const [category, entries] of categories) {
    report.byCategory[category] = {
      sampleSize: entries.length,
      recallAt5: mean(entries.map((o) => (hitAtK(o.results, o.expected, 5) ? 1 : 0))),
      mrr: mean(entries.map((o) => reciprocalRank(o.results, o.expected))),
    };
  }

  return report;
}
