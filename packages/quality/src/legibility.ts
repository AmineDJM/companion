/**
 * Legibility scoring for recovered text.
 *
 * When a page has no usable embedded text, Companion reads it from the
 * rendered image with the vision model. A vision model returns prose, not a
 * per-character confidence, so confidence has to be derived from the text
 * itself: real prose has a characteristic shape, and a failed read does not.
 *
 * This is deterministic. Nothing here asks the model how well it thinks it
 * did — a model that misread a page will report the misreading confidently.
 */
export interface LegibilityInput {
  /** The text recovered from the page image. */
  text: string;
  /**
   * Proportion of the page that carries ink, from the rendered image. A page
   * that is visibly dense but yielded almost no text is the failure that
   * matters most, and text alone cannot reveal it.
   */
  inkRatio?: number;
}

export interface LegibilityReport {
  /** 0..1. Compared against ingestion.vision_read_confidence. */
  score: number;
  characterCount: number;
  wordCount: number;
  /** Share of characters that are letters or digits rather than symbols. */
  alphanumericRatio: number;
  /** Share of words with a plausible written shape. */
  wellFormedWordRatio: number;
  /** Mean word length, which collapses when a read degrades into fragments. */
  meanWordLength: number;
  /** Set when the page looks inked but produced little text. */
  suspectedEmptyRead: boolean;
  reasons: string[];
}

/** A word is well formed when it is letters with at most one internal mark. */
const WELL_FORMED = /^[\p{L}][\p{L}'’-]*[\p{L}.,;:!?)]?$|^\d+([.,]\d+)*[%]?$/u;

export function assessLegibility(input: LegibilityInput): LegibilityReport {
  const text = input.text.replace(/\s+/g, ' ').trim();
  const characterCount = text.length;
  const words = text.split(' ').filter(Boolean);
  const wordCount = words.length;
  const reasons: string[] = [];

  if (characterCount === 0) {
    return {
      score: 0,
      characterCount: 0,
      wordCount: 0,
      alphanumericRatio: 0,
      wellFormedWordRatio: 0,
      meanWordLength: 0,
      suspectedEmptyRead: (input.inkRatio ?? 0) > 0.01,
      reasons: ['No text was recovered from the page.'],
    };
  }

  const alphanumeric = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const alphanumericRatio = alphanumeric / characterCount;

  const wellFormed = words.filter((word) => WELL_FORMED.test(word)).length;
  const wellFormedWordRatio = wordCount === 0 ? 0 : wellFormed / wordCount;

  const meanWordLength =
    wordCount === 0 ? 0 : words.reduce((total, word) => total + word.length, 0) / wordCount;

  // A page with visible ink that produced almost nothing was not read.
  const suspectedEmptyRead = (input.inkRatio ?? 0) > 0.03 && characterCount < 40;
  if (suspectedEmptyRead) reasons.push('The page carries ink but produced almost no text.');
  if (alphanumericRatio < 0.6) reasons.push('Unusually high proportion of symbols.');
  if (wellFormedWordRatio < 0.7) reasons.push('Many words have an implausible shape.');
  if (meanWordLength < 2.2) reasons.push('Text has degraded into fragments.');
  if (meanWordLength > 18) reasons.push('Words are implausibly long; spacing was probably lost.');

  // Weighted so that word shape dominates: it is the strongest single signal
  // that a read produced language rather than noise.
  const shapeScore = clamp((meanWordLength - 1.5) / 3.5);
  const score = clamp(
    0.5 * wellFormedWordRatio + 0.3 * alphanumericRatio + 0.2 * shapeScore,
  );

  return {
    score: suspectedEmptyRead ? Math.min(score, 0.2) : Number(score.toFixed(3)),
    characterCount,
    wordCount,
    alphanumericRatio: Number(alphanumericRatio.toFixed(3)),
    wellFormedWordRatio: Number(wellFormedWordRatio.toFixed(3)),
    meanWordLength: Number(meanWordLength.toFixed(2)),
    suspectedEmptyRead,
    reasons,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Whether a page's embedded text is good enough to use as-is.
 *
 * Scanned pages typically yield a handful of stray glyphs rather than nothing,
 * so a character count alone is not sufficient.
 */
export function needsVisionRead(embeddedText: string, minimumCharacters = 40): boolean {
  const report = assessLegibility({ text: embeddedText });
  if (report.characterCount < minimumCharacters) return true;
  if (report.alphanumericRatio < 0.45) return true;
  return report.wellFormedWordRatio < 0.55;
}
