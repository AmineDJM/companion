/**
 * Deterministic numeric comparison between an answer and its evidence.
 *
 * Numbers are where a plausible-sounding answer does the most damage: a
 * decimal shift turns €50,000 into €500,000 and reads perfectly. Nothing here
 * asks a model whether the figures look right — the literals are parsed,
 * normalised and compared.
 */
export interface ParsedNumber {
  /** The value in its base unit, with scale words applied. */
  value: number;
  raw: string;
  currency: string | null;
  isPercentage: boolean;
  /** Multiplier implied by a trailing scale word, e.g. 1e6 for "million". */
  scale: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
  '¥': 'JPY',
};

const CURRENCY_CODES = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK']);

const SCALE_WORDS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  bn: 1e9,
  billion: 1e9,
  billions: 1e9,
};

/**
 * Matches a number with optional currency, grouping separators, decimals and a
 * scale word. Both `1,234.56` and `1.234,56` are recognised.
 */
const NUMBER_PATTERN =
  /(?:(€|\$|£|¥)\s?)?(?:\b(EUR|USD|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK)\s?)?(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(%|k\b|thousand\b|mn\b|m\b|million[s]?\b|bn\b|billion[s]?\b)?(?:\s?(EUR|USD|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK)\b)?/gi;

export function parseNumbers(text: string): ParsedNumber[] {
  const results: ParsedNumber[] = [];
  NUMBER_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = NUMBER_PATTERN.exec(text)) !== null) {
    const [raw, symbol, codeBefore, digits, suffix, codeAfter] = match;
    if (!digits) continue;

    const numeric = normaliseDigits(digits);
    if (numeric === null) continue;

    const lowerSuffix = suffix?.toLowerCase();
    const isPercentage = lowerSuffix === '%';
    const scale = lowerSuffix && !isPercentage ? (SCALE_WORDS[lowerSuffix] ?? 1) : 1;

    const currencyCode = codeBefore ?? codeAfter;
    const currency =
      (symbol ? CURRENCY_SYMBOLS[symbol] : undefined) ??
      (currencyCode && CURRENCY_CODES.has(currencyCode.toUpperCase())
        ? currencyCode.toUpperCase()
        : null);

    results.push({
      value: numeric * scale,
      raw: raw.trim(),
      currency,
      isPercentage,
      scale,
    });
  }

  return results;
}

/**
 * Turns a grouped numeric string into a number.
 *
 * Decides between `1.234,56` and `1,234.56` by looking at which separator
 * appears last and how many digits follow it, rather than assuming a locale.
 */
function normaliseDigits(input: string): number | null {
  const cleaned = input.replace(/\s/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalised: string;
  if (lastComma === -1 && lastDot === -1) {
    normalised = cleaned;
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator: 1.234,56
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is the decimal separator: 1,234.56
    normalised = cleaned.replace(/,/g, '');
  } else {
    normalised = cleaned;
  }

  // A trailing group of exactly three digits after a lone separator is a
  // thousands group, not a decimal: "48,000" is forty-eight thousand.
  const loneSeparator = /^(\d{1,3})([.,])(\d{3})$/.exec(cleaned);
  if (loneSeparator) normalised = `${loneSeparator[1]}${loneSeparator[3]}`;

  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : null;
}

export interface NumericMismatch {
  answerNumber: ParsedNumber;
  /** The closest evidence number, when one exists at all. */
  nearest: ParsedNumber | null;
  reason: 'absent' | 'magnitude' | 'currency' | 'percentage';
  /** Ratio between the answer and the nearest evidence value. */
  ratio: number | null;
}

export interface NumericCheck {
  answerNumbers: ParsedNumber[];
  evidenceNumbers: ParsedNumber[];
  mismatches: NumericMismatch[];
  /** Share of answer numbers that are supported by the evidence. */
  consistency: number;
}

/** Relative tolerance for rounding, e.g. "about 62%" against 61.8%. */
const RELATIVE_TOLERANCE = 0.005;

/**
 * Verifies that every number an answer states appears in the evidence.
 *
 * Small ordinals (page numbers, clause numbers, counts under ten) are ignored:
 * they are overwhelmingly references rather than claims, and treating them as
 * facts produces noise that would bury a real decimal error.
 */
export function checkNumericConsistency(answer: string, evidence: string): NumericCheck {
  const answerNumbers = parseNumbers(answer).filter(isMaterial);
  const evidenceNumbers = parseNumbers(evidence);
  const mismatches: NumericMismatch[] = [];

  for (const number of answerNumbers) {
    const candidates = evidenceNumbers.filter(
      (candidate) => candidate.isPercentage === number.isPercentage,
    );

    const exact = candidates.find((candidate) => withinTolerance(candidate.value, number.value));
    if (exact) {
      // A figure quoted in a different currency than the source is an error
      // even when the digits agree.
      if (number.currency && exact.currency && number.currency !== exact.currency) {
        mismatches.push({ answerNumber: number, nearest: exact, reason: 'currency', ratio: 1 });
      }
      continue;
    }

    const nearest = closest(candidates, number.value);
    if (!nearest) {
      mismatches.push({ answerNumber: number, nearest: null, reason: 'absent', ratio: null });
      continue;
    }

    const ratio = nearest.value === 0 ? null : number.value / nearest.value;
    mismatches.push({
      answerNumber: number,
      nearest,
      // A clean power-of-ten ratio is the classic decimal or scale error.
      reason: ratio !== null && isScaleError(ratio) ? 'magnitude' : 'absent',
      ratio,
    });
  }

  return {
    answerNumbers,
    evidenceNumbers,
    mismatches,
    consistency:
      answerNumbers.length === 0
        ? 1
        : (answerNumbers.length - mismatches.length) / answerNumbers.length,
  };
}

function isMaterial(number: ParsedNumber): boolean {
  if (number.currency !== null || number.isPercentage) return true;
  if (number.scale > 1) return true;
  return Math.abs(number.value) >= 10;
}

function withinTolerance(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) / scale <= RELATIVE_TOLERANCE;
}

function closest(candidates: ParsedNumber[], value: number): ParsedNumber | null {
  let best: ParsedNumber | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.value - value);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function isScaleError(ratio: number): boolean {
  const magnitude = Math.log10(Math.abs(ratio));
  return Math.abs(magnitude - Math.round(magnitude)) < 0.02 && Math.round(magnitude) !== 0;
}
