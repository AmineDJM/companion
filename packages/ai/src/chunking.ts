import { createHash } from 'node:crypto';
import { estimateTokens, type DocumentKind, type UnitKind } from '@companion/shared';

/**
 * Semantic chunking.
 *
 * Documents are never split every N characters. Each document unit (a page, a
 * slide, a sheet region, a heading-bounded section) is chunked on its own, so a
 * chunk never straddles two pages and every chunk keeps an exact citation
 * location. Long units are split on paragraph boundaries with a small overlap.
 */

export interface ChunkSourceUnit {
  unitId: string;
  kind: UnitKind;
  ordinal: number;
  page: number | null;
  slide: number | null;
  sheetName: string | null;
  range: string | null;
  sectionTitle: string | null;
  text: string;
}

export interface ChunkResult {
  unitId: string;
  ordinal: number;
  text: string;
  tokenEstimate: number;
  page: number | null;
  slide: number | null;
  sheetName: string | null;
  range: string | null;
  sectionTitle: string | null;
  contentHash: string;
}

export interface ChunkingOptions {
  /** Target tokens per chunk. Retrieval works best around this size. */
  targetTokens?: number;
  /** A chunk is never allowed past this, whatever the paragraph structure. */
  maxTokens?: number;
  /** Below this, a chunk is merged into its neighbour rather than stored alone. */
  minTokens?: number;
  /** Tokens of trailing context repeated at the start of the next chunk. */
  overlapTokens?: number;
}

const DEFAULTS: Required<ChunkingOptions> = {
  targetTokens: 320,
  maxTokens: 600,
  minTokens: 40,
  overlapTokens: 48,
};

/** Per-format tuning. Slides are short; spreadsheets tolerate wider chunks. */
export function optionsForKind(kind: DocumentKind): ChunkingOptions {
  switch (kind) {
    case 'SLIDES':
      return { targetTokens: 220, maxTokens: 450, minTokens: 12, overlapTokens: 0 };
    case 'SPREADSHEET':
      return { targetTokens: 420, maxTokens: 800, minTokens: 20, overlapTokens: 0 };
    case 'IMAGE':
      return { targetTokens: 320, maxTokens: 600, minTokens: 8, overlapTokens: 0 };
    default:
      return {};
  }
}

export function chunkUnits(
  units: ChunkSourceUnit[],
  options: ChunkingOptions = {},
): ChunkResult[] {
  const config = { ...DEFAULTS, ...stripUndefined(options) };
  const chunks: ChunkResult[] = [];
  let ordinal = 0;
  let carry: { unit: ChunkSourceUnit; text: string } | null = null;

  for (const unit of units) {
    const normalized = normaliseWhitespace(unit.text);
    if (!normalized) continue;

    const pieces = splitUnit(normalized, config);

    for (let index = 0; index < pieces.length; index += 1) {
      let text = pieces[index] as string;

      // A tiny trailing fragment rides along with the next chunk instead of
      // becoming a near-useless standalone entry.
      if (carry) {
        text = `${carry.text}\n\n${text}`;
        carry = null;
      }

      const tokens = estimateTokens(text);
      const isLastPieceOfUnit = index === pieces.length - 1;
      const isLastUnit = unit === units[units.length - 1];
      if (tokens < config.minTokens && isLastPieceOfUnit && !isLastUnit) {
        carry = { unit, text };
        continue;
      }

      chunks.push(makeChunk(unit, text, ordinal++));
    }
  }

  if (carry) chunks.push(makeChunk(carry.unit, carry.text, ordinal++));
  return chunks;
}

function makeChunk(unit: ChunkSourceUnit, text: string, ordinal: number): ChunkResult {
  // The heading is prefixed so a chunk lifted out of context still states what
  // it is about — this measurably improves both lexical and semantic recall.
  const prefixed = unit.sectionTitle && !text.startsWith(unit.sectionTitle)
    ? `${unit.sectionTitle}\n${text}`
    : text;
  return {
    unitId: unit.unitId,
    ordinal,
    text: prefixed,
    tokenEstimate: estimateTokens(prefixed),
    page: unit.page,
    slide: unit.slide,
    sheetName: unit.sheetName,
    range: unit.range,
    sectionTitle: unit.sectionTitle,
    contentHash: hashChunk(prefixed),
  };
}

/** Splits one unit on paragraph, then sentence, then hard boundaries. */
function splitUnit(text: string, config: Required<ChunkingOptions>): string[] {
  if (estimateTokens(text) <= config.maxTokens) return [text];

  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    // A single paragraph larger than the cap is split on sentences.
    if (paragraphTokens > config.maxTokens) {
      flush();
      for (const piece of splitLongParagraph(paragraph, config)) chunks.push(piece);
      continue;
    }

    const combined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTokens(combined) > config.targetTokens && current) {
      flush();
      current = withOverlap(chunks[chunks.length - 1], paragraph, config.overlapTokens);
    } else {
      current = combined;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [text];
}

function splitLongParagraph(paragraph: string, config: Required<ChunkingOptions>): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const combined = current + sentence;
    if (estimateTokens(combined) > config.targetTokens && current) {
      out.push(current.trim());
      current = sentence;
    } else {
      current = combined;
    }
    // A single sentence longer than the cap (minified text, a huge table row)
    // is cut on a hard character boundary as a last resort.
    while (estimateTokens(current) > config.maxTokens) {
      const cutAt = Math.floor(config.maxTokens * 3.6);
      out.push(current.slice(0, cutAt).trim());
      current = current.slice(cutAt);
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Repeats the tail of the previous chunk so a boundary cannot hide an answer. */
function withOverlap(previous: string | undefined, next: string, overlapTokens: number): string {
  if (!previous || overlapTokens <= 0) return next;
  const overlapChars = Math.floor(overlapTokens * 3.6);
  const tail = previous.slice(-overlapChars);
  const boundary = tail.search(/[.!?]\s/);
  const clean = boundary >= 0 ? tail.slice(boundary + 2) : tail;
  return clean ? `${clean.trim()}\n\n${next}` : next;
}

export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Collapse the runs of spaces PDF extraction leaves between glyphs.
    .replace(/[ \t ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
}

export function hashChunk(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function stripUndefined<T extends object>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * Splits a long text document into heading-bounded sections. Used for DOCX,
 * Markdown and plain text, where "page" is not a meaningful unit.
 */
export interface TextSection {
  title: string | null;
  text: string;
}

export function splitIntoSections(text: string, maxSectionTokens = 1_400): TextSection[] {
  const normalized = normaliseWhitespace(text);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const sections: TextSection[] = [];
  let title: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ title, text: body });
    buffer = [];
  };

  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      title = line.replace(/^#+\s*/, '').replace(/[:.\s]+$/, '').trim().slice(0, 300) || null;
      continue;
    }
    buffer.push(line);
    if (estimateTokens(buffer.join('\n')) > maxSectionTokens) {
      flush();
      // Keep the heading for continuation sections so citations stay meaningful.
    }
  }
  flush();

  return sections.length > 0 ? sections : [{ title: null, text: normalized }];
}

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  // Numbered clause headings, very common in contracts: "4.2 Termination".
  if (/^\d+(\.\d+)*\.?\s+[A-Z\p{Lu}][^.!?]{2,100}$/u.test(trimmed)) return true;
  // ALL-CAPS headings with no terminal punctuation.
  if (/^[A-Z\p{Lu}][A-Z\p{Lu}\s\d&'/-]{3,80}$/u.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return true;
  }
  return false;
}
