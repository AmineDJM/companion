/**
 * Deterministic ranking helpers used by the hybrid retriever.
 *
 * Lexical (Postgres full-text) and semantic (pgvector) results are fused with
 * Reciprocal Rank Fusion, which needs no score normalisation between two very
 * different scoring spaces and is stable across corpora.
 */

export interface RankedCandidate {
  id: string;
  score: number;
}

export interface FusionOptions {
  /** RRF damping constant. 60 is the value from the original TREC work. */
  k?: number;
  /** Relative trust in each list. Defaults to a slight lexical preference for exact terms. */
  weights?: { lexical: number; semantic: number };
}

export interface FusedResult {
  id: string;
  score: number;
  lexicalRank: number | null;
  semanticRank: number | null;
  /** True when both retrievers surfaced this chunk — a strong relevance signal. */
  agreement: boolean;
}

export function reciprocalRankFusion(
  lexical: RankedCandidate[],
  semantic: RankedCandidate[],
  options: FusionOptions = {},
): FusedResult[] {
  const k = options.k ?? 60;
  const weights = options.weights ?? { lexical: 1, semantic: 1.15 };

  const accumulator = new Map<string, FusedResult>();

  const absorb = (list: RankedCandidate[], weight: number, key: 'lexicalRank' | 'semanticRank') => {
    list.forEach((candidate, index) => {
      const rank = index + 1;
      const contribution = weight / (k + rank);
      const existing = accumulator.get(candidate.id);
      if (existing) {
        existing.score += contribution;
        existing[key] = rank;
        existing.agreement = existing.lexicalRank !== null && existing.semanticRank !== null;
      } else {
        accumulator.set(candidate.id, {
          id: candidate.id,
          score: contribution,
          lexicalRank: key === 'lexicalRank' ? rank : null,
          semanticRank: key === 'semanticRank' ? rank : null,
          agreement: false,
        });
      }
    });
  };

  absorb(lexical, weights.lexical, 'lexicalRank');
  absorb(semantic, weights.semantic, 'semanticRank');

  return [...accumulator.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tiebreak keeps results stable between identical requests.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface ContextBoost {
  /** Chunks from the file the recipient is currently reading. */
  activeFileId: string | null;
  /** Page/slide currently on screen. */
  activePage: number | null;
}

export interface BoostableChunk {
  id: string;
  fileId: string;
  page: number | null;
}

/**
 * Nudges results toward what the recipient is actually looking at. The boost is
 * multiplicative and small: it reorders near-ties without letting the active
 * page beat a genuinely better match elsewhere in the bundle.
 */
export function applyContextBoost<T extends BoostableChunk>(
  results: FusedResult[],
  chunks: Map<string, T>,
  context: ContextBoost,
): FusedResult[] {
  if (!context.activeFileId) return results;
  return results
    .map((result) => {
      const chunk = chunks.get(result.id);
      if (!chunk) return result;
      let multiplier = 1;
      if (chunk.fileId === context.activeFileId) multiplier *= 1.15;
      if (
        context.activePage !== null &&
        chunk.page !== null &&
        Math.abs(chunk.page - context.activePage) <= 1
      ) {
        multiplier *= 1.25;
      }
      return { ...result, score: result.score * multiplier };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Keeps one Companion's answer from being dominated by a single long file when
 * the question spans several documents.
 */
export function diversifyByFile<T extends { fileId: string }>(
  items: T[],
  limit: number,
  maxPerFile: number,
): T[] {
  const perFile = new Map<string, number>();
  const selected: T[] = [];
  const overflow: T[] = [];

  for (const item of items) {
    const count = perFile.get(item.fileId) ?? 0;
    if (count < maxPerFile) {
      perFile.set(item.fileId, count + 1);
      selected.push(item);
      if (selected.length === limit) return selected;
    } else {
      overflow.push(item);
    }
  }
  // Backfill with the best remaining chunks if diversity left us short.
  for (const item of overflow) {
    if (selected.length === limit) break;
    selected.push(item);
  }
  return selected;
}

/**
 * Rough token estimate. Deliberately conservative (over-estimates slightly) so
 * the context budget is never blown by a tokenizer disagreement.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~3.6 chars/token for prose with punctuation and numbers.
  return Math.ceil(text.length / 3.6);
}

/** Trims a candidate list so its combined text fits the context budget. */
export function fitToTokenBudget<T extends { text: string }>(
  items: T[],
  budgetTokens: number,
): { kept: T[]; usedTokens: number } {
  const kept: T[] = [];
  let usedTokens = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (usedTokens + cost > budgetTokens && kept.length > 0) break;
    kept.push(item);
    usedTokens += cost;
  }
  return { kept, usedTokens };
}

/**
 * Decides whether a question needs the expensive path (wider retrieval, higher
 * reasoning). Kept deliberately cheap: no model call is involved.
 */
const COMPLEXITY_SIGNALS =
  /\b(compare|comparison|versus|vs\.?|contradict|inconsistenc|discrepanc|across (?:all|the|these)|difference between|reconcile|aggregate|total(?:s)? across|which (?:of (?:these|the))|between (?:the )?(?:two|three|several)|summar(?:ise|ize) all|cross[- ]reference)\b/i;

export function isComplexQuestion(question: string, fileCount: number): boolean {
  if (COMPLEXITY_SIGNALS.test(question)) return true;
  // Questions that name several documents in a multi-file bundle usually need
  // more than one file's worth of context.
  if (fileCount > 1 && /\b(these|all|both|each)\b.*\b(files?|documents?|sheets?|decks?)\b/i.test(question)) {
    return true;
  }
  return false;
}
