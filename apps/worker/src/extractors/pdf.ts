import { createRequire } from 'node:module';
import { normaliseWhitespace } from '@companion/ai';
import { needsVisionRead } from '@companion/quality';
import { EMPTY_EXTRACTION, type ExtractedUnit, type ExtractionResult } from './types.js';

const require = createRequire(import.meta.url);

/**
 * PDF text extraction, one unit per page.
 *
 * Embedded text is always preferred: it is exact and free. A page whose
 * embedded text is missing or garbled — a scan, or a PDF with broken encoding —
 * is handed to the page reader, which reads the rendered image with the vision
 * model. pdf.js is loaded through its legacy Node build, so no canvas and no
 * DOM are required.
 */
interface PdfTextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

export interface PdfExtractionOptions {
  maxPages: number;
  /**
   * Reads a page that has no usable embedded text. Returns the recovered text
   * and a deterministic legibility score, or null when no reader is available.
   */
  readPage?: (
    page: number,
    embeddedText: string,
  ) => Promise<{ text: string; score: number; usedVision: boolean; blank: boolean } | null>;
}

export async function extractPdf(
  buffer: Buffer,
  options: PdfExtractionOptions,
): Promise<ExtractionResult> {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs') as {
    getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDocument> };
  };

  let document: PdfDocument;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // No network fetches, no eval, no font files needed for text extraction.
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    }).promise;
  } catch {
    return { ...EMPTY_EXTRACTION, notes: ['This PDF could not be opened.'] };
  }

  const pageCount = Math.min(document.numPages, options.maxPages);
  const units: ExtractedUnit[] = [];
  const notes: string[] = [];
  const lowConfidencePages: number[] = [];
  let usedVision = false;
  let readPages = 0;
  let blankPages = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    let text = '';
    try {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text = assemblePageText(content.items as PdfTextItem[]);
      page.cleanup();
    } catch {
      notes.push(`Page ${pageNumber} could not be read.`);
    }

    if (needsVisionRead(text) && options.readPage) {
      const recovered = await options.readPage(pageNumber, text);
      if (recovered?.usedVision) {
        usedVision = true;
        readPages += 1;
        if (recovered.blank) {
          blankPages += 1;
        } else if (recovered.text.trim().length > 0) {
          text = recovered.text;
        }
        // A page read below the legibility threshold is recorded rather than
        // silently accepted: the ingestion metric decides what happens next.
        if (!recovered.blank && recovered.score < 0.75) lowConfidencePages.push(pageNumber);
      }
    }

    const normalised = normaliseWhitespace(text);
    if (!normalised) continue;

    units.push({
      kind: 'PAGE',
      ordinal: pageNumber,
      page: pageNumber,
      slide: null,
      sheetName: null,
      range: null,
      sectionTitle: detectHeading(normalised),
      text: normalised,
    });
  }

  if (document.numPages > options.maxPages) {
    notes.push(`Only the first ${options.maxPages} pages were indexed.`);
  }
  if (readPages > 0) {
    notes.push(
      `${readPages} scanned ${readPages === 1 ? 'page was' : 'pages were'} read from the page image.`,
    );
  }
  if (lowConfidencePages.length > 0) {
    notes.push(
      `${lowConfidencePages.length} ${lowConfidencePages.length === 1 ? 'page was' : 'pages were'} hard to read; answers from ${lowConfidencePages.length === 1 ? 'it' : 'them'} may be incomplete.`,
    );
  }

  await document.destroy?.();
  return {
    units,
    pageCount: document.numPages,
    usedVision,
    notes,
    declaredUnits: document.numPages,
    lowConfidenceUnits: lowConfidencePages,
    blankUnits: blankPages,
  };
}

interface PdfDocument {
  numPages: number;
  getPage: (index: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>;
    cleanup: () => void;
  }>;
  destroy?: () => Promise<void>;
}

/**
 * Reassembles text items into lines.
 *
 * pdf.js emits positioned fragments, not lines. Grouping by the vertical
 * transform component restores reading order and stops words from two columns
 * being glued together.
 */
function assemblePageText(items: PdfTextItem[]): string {
  const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
  const TOLERANCE = 2.5;

  for (const item of items) {
    const value = item.str ?? '';
    if (!value) continue;
    const transform = item.transform ?? [];
    const x = typeof transform[4] === 'number' ? transform[4] : 0;
    const y = typeof transform[5] === 'number' ? transform[5] : 0;

    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= TOLERANCE);
    if (line) line.parts.push({ x, text: value });
    else lines.push({ y, parts: [{ x, text: value }] });
  }

  // PDF origin is bottom-left, so descending y is top-to-bottom reading order.
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join('')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

/** First line of a page, when it reads like a heading rather than prose. */
function detectHeading(text: string): string | null {
  const first = text.split('\n')[0]?.trim();
  if (!first || first.length > 110 || first.length < 3) return null;
  if (/[.!?]$/.test(first)) return null;
  if (/^\d+$/.test(first)) return null;
  return first;
}
