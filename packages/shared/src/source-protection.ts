import type { SourceProtectionMode } from './constants.js';

/**
 * Structural protection against using the Ask feature as a download backdoor.
 *
 * Three independent layers exist; this module is the first and third:
 *   1. an inbound request classifier (below) that refuses bulk-extraction asks
 *   2. bounded retrieval — the model never receives the whole document anyway
 *   3. an outbound answer check (below) that caps verbatim quoting per answer
 *      and tracks cumulative extraction across a recipient session.
 *
 * None of this relies on the model's goodwill.
 */

export type ExtractionIntent =
  | 'none'
  | 'bulk_reproduction'
  | 'page_range_dump'
  | 'sequential_continuation'
  | 'verbatim_transcription';

export interface RequestClassification {
  intent: ExtractionIntent;
  /** 0..1 confidence that this request is an extraction attempt. */
  score: number;
  blocked: boolean;
  /** Recipient-facing explanation when blocked. */
  reason: string | null;
}

interface Rule {
  intent: Exclude<ExtractionIntent, 'none'>;
  pattern: RegExp;
  weight: number;
}

/**
 * Patterns target the *shape* of an extraction request (whole-document scope +
 * reproduction verb), not individual keywords, so that legitimate questions
 * like "quote the termination clause" are never caught.
 */
const RULES: Rule[] = [
  // "give me the entire document word for word", "reproduce the full contract"
  {
    intent: 'bulk_reproduction',
    pattern:
      /\b(give|show|send|provide|output|print|paste|write|reproduce|transcribe|dump|export|copy|recreate|reconstruct|retype|render)\b[^.?!]{0,60}\b(entire|whole|complete|full|all(?:\s+of)?(?:\s+the)?|every)\b[^.?!]{0,40}\b(document|documents|pdf|file|files|text|contract|report|deck|book|content|pages?|chapters?|sections?)\b/i,
    weight: 0.95,
  },
  {
    intent: 'verbatim_transcription',
    pattern:
      /\b(word[-\s]?for[-\s]?word|verbatim|character[-\s]?by[-\s]?character|line[-\s]?by[-\s]?line|exact(?:ly)?\s+as\s+(?:it\s+)?(?:is\s+)?written|in\s+full,?\s+verbatim|raw\s+text|full\s+transcript(?:ion)?)\b/i,
    weight: 0.8,
  },
  // "output pages 1-40", "print pages 3 through 25"
  {
    intent: 'page_range_dump',
    pattern:
      /\b(pages?|slides?|sheets?|chapters?|sections?)\s*\d{1,4}\s*(?:-|–|—|to|through|until|thru)\s*\d{1,4}\b/i,
    weight: 0.55,
  },
  {
    intent: 'page_range_dump',
    pattern:
      /\b(give|show|output|print|write|transcribe|reproduce|list|paste|dump)\b[^.?!]{0,30}\b(each|every|all)\s+(pages?|slides?|sheets?|paragraphs?|lines?|sentences?|clauses?)\b/i,
    weight: 0.85,
  },
  // "continue", "next page please", "keep going from where you stopped"
  {
    intent: 'sequential_continuation',
    pattern:
      /^\s*(continue|keep going|go on|next|more|and then\??|carry on)\b[^.?!]{0,40}$|\b(continue|resume|carry on)\b[^.?!]{0,30}\b(from|with|where)\b[^.?!]{0,30}\b(page|slide|paragraph|section|you\s+(?:left|stopped))\b|\b(next|following)\s+(page|slide|section|chapter|paragraph|part)\b/i,
    weight: 0.5,
  },
];

/** Phrases that signal a genuine comprehension question; they lower the score. */
const COMPREHENSION_HINTS =
  /\b(explain|summar(?:ise|ize)|what\s+(?:is|are|does)|why|how\s+(?:does|do|is)|compare|difference|which\s+section|where\s+is|does\s+the|is\s+there|when\s+(?:is|does)|who\s+(?:is|are)|risk|deadline|obligation|means?)\b/i;

export interface SessionExtractionState {
  /** Questions asked in this session that scored as extraction attempts. */
  extractionAttempts: number;
  /** Characters of verbatim quoting already returned to this session. */
  quotedCharacters: number;
  /** Distinct source units already quoted from, to detect page-walking. */
  quotedUnitIds: string[];
  /** Total answers delivered in this session. */
  answersDelivered: number;
}

export const EMPTY_EXTRACTION_STATE: SessionExtractionState = {
  extractionAttempts: 0,
  quotedCharacters: 0,
  quotedUnitIds: [],
  answersDelivered: 0,
};

export interface ProtectionThresholds {
  /** Score at or above which a request is refused outright. */
  blockScore: number;
  /** Longest single verbatim quote allowed in one answer, in characters. */
  maxQuoteCharsPerAnswer: number;
  /** Total verbatim characters allowed across the whole session. */
  maxQuoteCharsPerSession: number;
  /** Distinct source units a session may quote before quoting is capped. */
  maxQuotedUnitsPerSession: number;
  /** Extraction attempts before the session is hard-limited. */
  maxExtractionAttempts: number;
}

export const PROTECTION_THRESHOLDS: Record<SourceProtectionMode, ProtectionThresholds> = {
  OFF: {
    blockScore: 1.01, // never blocks
    maxQuoteCharsPerAnswer: 4_000,
    maxQuoteCharsPerSession: Number.MAX_SAFE_INTEGER,
    maxQuotedUnitsPerSession: Number.MAX_SAFE_INTEGER,
    maxExtractionAttempts: Number.MAX_SAFE_INTEGER,
  },
  STANDARD: {
    blockScore: 0.75,
    maxQuoteCharsPerAnswer: 1_200,
    maxQuoteCharsPerSession: 20_000,
    maxQuotedUnitsPerSession: 60,
    maxExtractionAttempts: 8,
  },
  STRICT: {
    blockScore: 0.5,
    maxQuoteCharsPerAnswer: 500,
    maxQuotedUnitsPerSession: 25,
    maxQuoteCharsPerSession: 6_000,
    maxExtractionAttempts: 4,
  },
};

export const PROTECTION_REFUSAL_MESSAGE =
  "I can explain, summarise or point you to any part of this material, but I can't reproduce the shared documents in full.";

export function classifyRequest(
  question: string,
  mode: SourceProtectionMode,
  session: SessionExtractionState = EMPTY_EXTRACTION_STATE,
): RequestClassification {
  const thresholds = PROTECTION_THRESHOLDS[mode];
  if (mode === 'OFF') {
    return { intent: 'none', score: 0, blocked: false, reason: null };
  }

  const normalized = question.trim().replace(/\s+/g, ' ');
  let best: { intent: Exclude<ExtractionIntent, 'none'>; score: number } | null = null;

  for (const rule of RULES) {
    if (!rule.pattern.test(normalized)) continue;
    if (!best || rule.weight > best.score) {
      best = { intent: rule.intent, score: rule.weight };
    }
  }

  if (!best) {
    return { intent: 'none', score: 0, blocked: false, reason: null };
  }

  let score = best.score;

  // A clearly analytical framing makes an extraction reading less likely.
  if (COMPREHENSION_HINTS.test(normalized) && best.intent !== 'bulk_reproduction') {
    score -= 0.25;
  }

  // Repeated attempts in one session escalate: page-walking is the real threat.
  if (session.extractionAttempts > 0) {
    score += Math.min(session.extractionAttempts * 0.12, 0.4);
  }
  if (session.quotedUnitIds.length >= thresholds.maxQuotedUnitsPerSession) {
    score += 0.3;
  }

  score = Math.max(0, Math.min(score, 1));
  const blocked =
    score >= thresholds.blockScore || session.extractionAttempts >= thresholds.maxExtractionAttempts;

  return {
    intent: best.intent,
    score: Number(score.toFixed(3)),
    blocked,
    reason: blocked ? PROTECTION_REFUSAL_MESSAGE : null,
  };
}

export interface QuoteEnforcementResult {
  /** The quote after truncation, or null when quoting is no longer permitted. */
  quote: string | null;
  truncated: boolean;
}

/** Applies the per-answer and per-session verbatim caps to a single citation quote. */
export function enforceQuoteLimit(
  quote: string,
  mode: SourceProtectionMode,
  session: SessionExtractionState,
  alreadyUsedInThisAnswer = 0,
): QuoteEnforcementResult {
  const thresholds = PROTECTION_THRESHOLDS[mode];
  if (mode === 'OFF') return { quote, truncated: false };

  const sessionRemaining = thresholds.maxQuoteCharsPerSession - session.quotedCharacters;
  const answerRemaining = thresholds.maxQuoteCharsPerAnswer - alreadyUsedInThisAnswer;
  const budget = Math.min(sessionRemaining, answerRemaining);

  if (budget <= 0) return { quote: null, truncated: true };
  if (quote.length <= budget) return { quote, truncated: false };

  // Cut on a word boundary so a truncated quote still reads as prose. The
  // ellipsis counts against the budget: without that, every truncation would
  // overshoot by one character and a long session would drift past its cap.
  const room = budget - 1;
  if (room <= 0) return { quote: null, truncated: true };
  const slice = quote.slice(0, room);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > room * 0.6 ? slice.slice(0, lastSpace) : slice;
  return { quote: `${cut.trimEnd()}…`, truncated: true };
}

export function nextExtractionState(
  session: SessionExtractionState,
  update: {
    wasExtractionAttempt: boolean;
    quotedCharacters: number;
    quotedUnitIds: string[];
    answerDelivered: boolean;
  },
): SessionExtractionState {
  const units = new Set(session.quotedUnitIds);
  for (const id of update.quotedUnitIds) units.add(id);
  return {
    extractionAttempts: session.extractionAttempts + (update.wasExtractionAttempt ? 1 : 0),
    quotedCharacters: session.quotedCharacters + Math.max(update.quotedCharacters, 0),
    // Bounded so the session row cannot grow without limit.
    quotedUnitIds: [...units].slice(-500),
    answersDelivered: session.answersDelivered + (update.answerDelivered ? 1 : 0),
  };
}
