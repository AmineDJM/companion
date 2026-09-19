import mammoth from 'mammoth';
import yauzl from 'yauzl';
import { normaliseWhitespace, splitIntoSections } from '@companion/ai';
import { EMPTY_EXTRACTION, type ExtractedUnit, type ExtractionResult } from './types.js';

/**
 * Word documents.
 *
 * A DOCX has no pages until it is laid out, so the addressable unit is a
 * heading-bounded section. Mammoth's markdown output keeps heading levels,
 * which is exactly what the section splitter needs.
 */
export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch {
    return { ...EMPTY_EXTRACTION, notes: ['This document could not be read.'] };
  }

  const sections = splitIntoSections(htmlToStructuredText(html));
  const units: ExtractedUnit[] = sections.map((section, index) => ({
    kind: 'SECTION',
    ordinal: index + 1,
    page: null,
    slide: null,
    sheetName: null,
    range: null,
    sectionTitle: section.title,
    text: section.text,
  }));

  return { units, pageCount: null, usedVision: false, notes: [] };
}

/**
 * Converts Mammoth's HTML into text that keeps document structure.
 *
 * Headings become markdown hashes so the section splitter can find them, list
 * items keep their bullets, and table cells stay on one row — which is what
 * makes a contract's clause numbering survive into the citations.
 */
export function htmlToStructuredText(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, content: string) => {
      const hashes = '#'.repeat(Number.parseInt(level, 10));
      return `\n\n${hashes} ${stripTags(content)}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content: string) => `\n- ${stripTags(content)}`)
    .replace(/<\/(?:p|div|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * PowerPoint decks, one unit per slide.
 *
 * PPTX is an OOXML ZIP; reading the slide XML directly is far more reliable
 * than converting to PDF first, and it preserves the slide numbering that
 * citations need. Speaker notes are included because they often hold the
 * substance a reader asks about.
 */
export async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  let files: Map<string, string>;
  try {
    files = await readZipTextEntries(buffer, /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/);
  } catch {
    return { ...EMPTY_EXTRACTION, notes: ['This presentation could not be read.'] };
  }

  const slideNumbers = new Set<number>();
  for (const name of files.keys()) {
    const match = /slide(\d+)\.xml$/.exec(name);
    if (match?.[1]) slideNumbers.add(Number.parseInt(match[1], 10));
  }

  const units: ExtractedUnit[] = [];
  for (const slideNumber of [...slideNumbers].sort((a, b) => a - b)) {
    const slideXml = files.get(`ppt/slides/slide${slideNumber}.xml`);
    if (!slideXml) continue;

    const body = extractOoxmlText(slideXml);
    const notesXml = files.get(`ppt/notesSlides/notesSlide${slideNumber}.xml`);
    const notes = notesXml ? extractOoxmlText(notesXml) : '';

    const combined = normaliseWhitespace(
      notes ? `${body}\n\nSpeaker notes:\n${notes}` : body,
    );
    if (!combined) continue;

    units.push({
      kind: 'SLIDE',
      ordinal: slideNumber,
      page: slideNumber,
      slide: slideNumber,
      sheetName: null,
      range: null,
      // The first line of a slide is almost always its title.
      sectionTitle: body.split('\n')[0]?.trim().slice(0, 200) || null,
      text: combined,
    });
  }

  return {
    units,
    pageCount: units.length,
    usedVision: false,
    notes: [],
    declaredUnits: slideNumbers.size,
  };
}

/**
 * Pulls the text out of OOXML markup.
 *
 * `<a:t>` holds drawing text (slides), `<w:t>` holds document text. Paragraph
 * and line-break tags become newlines so structure survives.
 */
export function extractOoxmlText(xml: string): string {
  const withBreaks = xml
    .replace(/<a:p[ >]/g, '\n<a:p ')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<w:br\s*\/>/g, '\n');

  const parts: string[] = [];
  const pattern = /<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g;
  let match: RegExpExecArray | null;
  let cursor = 0;

  while ((match = pattern.exec(withBreaks)) !== null) {
    // Preserve the newlines that fell between two text runs.
    const between = withBreaks.slice(cursor, match.index);
    if (between.includes('\n')) parts.push('\n');
    parts.push(decodeXmlEntities(match[1] ?? ''));
    cursor = pattern.lastIndex;
  }

  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}

/** Reads the matching text entries out of an OOXML container. */
function readZipTextEntries(buffer: Buffer, pattern: RegExp): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(new Error('Could not open the document container.'));
        return;
      }
      const out = new Map<string, string>();

      zipfile.on('entry', (entry) => {
        if (!pattern.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        // A single OOXML part should never be enormous; cap it defensively.
        if (entry.uncompressedSize > 32 * 1024 * 1024) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipfile.readEntry();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            out.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zipfile.readEntry();
          });
          stream.on('error', () => zipfile.readEntry());
        });
      });

      zipfile.on('end', () => resolve(out));
      zipfile.on('error', () => reject(new Error('Malformed document container.')));
      zipfile.readEntry();
    });
  });
}
