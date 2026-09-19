import { createRequire } from 'node:module';
import { normaliseWhitespace } from '@companion/ai';
import { EMPTY_EXTRACTION, needsOcr, type ExtractedUnit, type ExtractionResult } from './types.js';

const require = createRequire(import.meta.url);

/**
 * PDF text extraction, one unit per page.
 *
 * Native text is always preferred; OCR is a fallback for pages that come back
 * empty or garbled (scans). pdf.js is loaded through its legacy Node build,
 * which needs no canvas and no DOM.
 */
interface PdfTextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

export async function extractPdf(
  buffer: Buffer,
  options: { maxPages: number; ocr?: (page: number) => Promise<string | null> },
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
  let usedOcr = false;
  let scannedPages = 0;

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

    if (needsOcr(text) && options.ocr) {
      const recognised = await options.ocr(pageNumber);
      if (recognised && recognised.trim().length > text.trim().length) {
        text = recognised;
        usedOcr = true;
        scannedPages += 1;
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
  if (scannedPages > 0) {
    notes.push(`${scannedPages} scanned ${scannedPages === 1 ? 'page was' : 'pages were'} read with text recognition.`);
  }

  await document.destroy?.();
  return { units, pageCount: document.numPages, usedOcr, notes };
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
