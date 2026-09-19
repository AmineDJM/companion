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
  /** True when a page had to be read from its rendered image. */
  usedVision: boolean;
  /** Non-fatal notes surfaced to the sender, e.g. "3 pages were scanned". */
  notes: string[];
  /**
   * Structural units the source container itself declares — the PDF page tree,
   * the slide parts, the workbook sheets. Compared against what was parsed so
   * a dropped page is caught rather than silently lost.
   */
  declaredUnits?: number;
  /** Pages whose recovered text scored below the legibility threshold. */
  lowConfidenceUnits?: number[];
  /** Pages the reader reported as genuinely blank. */
  blankUnits?: number;
}

export const EMPTY_EXTRACTION: ExtractionResult = {
  units: [],
  pageCount: null,
  usedVision: false,
  notes: [],
};


