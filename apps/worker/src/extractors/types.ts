import type { UnitKind } from '@companion/shared';

/**
 * One addressable location in a document. Citations resolve to these, so the
 * locator fields must be precise enough to navigate to.
 */
export interface ExtractedUnit {
  kind: UnitKind;
  /** 1-based ordinal within the document. */
  ordinal: number;
  page: number | null;
  slide: number | null;
  sheetName: string | null;
  /** Spreadsheet region, e.g. "A1:F40". */
  range: string | null;
  sectionTitle: string | null;
  text: string;
}

export interface ExtractionResult {
  units: ExtractedUnit[];
  pageCount: number | null;
  /** True when OCR had to be used because the native text was unusable. */
  usedOcr: boolean;
  /** Non-fatal notes surfaced to the sender, e.g. "3 pages were scanned". */
  notes: string[];
}

export const EMPTY_EXTRACTION: ExtractionResult = {
  units: [],
  pageCount: null,
  usedOcr: false,
  notes: [],
};

/**
 * Heuristic for "this page has no usable text".
 *
 * A scanned page usually yields a handful of stray glyphs rather than nothing,
 * so a character count alone is not enough — we also look at the proportion of
 * letters and the presence of real word shapes.
 */
export function needsOcr(text: string, expectedMinimum = 40): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < expectedMinimum) return true;
  const letters = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (letters / trimmed.length < 0.4) return true;
  const words = trimmed.split(/\s+/).filter((word) => /\p{L}{3,}/u.test(word));
  return words.length < 5;
}
