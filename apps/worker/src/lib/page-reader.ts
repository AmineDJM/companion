import { assessLegibility, needsVisionRead, type LegibilityReport } from '@companion/quality';
import { estimateCostUsd } from '@companion/shared';
import { schema } from '@companion/db';
import { container } from '../container.js';
import { env } from '../env.js';
import { rasterisePageForOcr } from './convert.js';

/**
 * Reading pages that have no usable embedded text.
 *
 * Companion does not run classical OCR. Tesseract on a real-world scan
 * produces text that is confidently wrong — merged columns, mangled tables,
 * plausible-looking garbage — and that text then poisons retrieval invisibly.
 * The vision model reads the page as a person would, and the result is scored
 * deterministically before it is allowed anywhere near the index.
 */
export interface PageReadOutcome {
  text: string;
  legibility: LegibilityReport;
  /** True when the vision reader was used rather than the embedded text. */
  usedVision: boolean;
  attempts: number;
  blank: boolean;
}

export interface PageReadRequest {
  /** Text already embedded in the document, which may be empty or garbled. */
  embeddedText: string;
  page: number;
  /** Renders the page to an image. Called only when a vision read is needed. */
  renderPage: (page: number, scale: number) => Promise<Buffer | null>;
  documentHint?: string | null;
  workspaceId: string;
  companionId: string;
}

/** Scales tried in order; a second pass at higher resolution rescues a dense page. */
const RENDER_SCALES = [300, 400] as const;

export async function readPage(request: PageReadRequest): Promise<PageReadOutcome> {
  const embedded = assessLegibility({ text: request.embeddedText });

  if (!needsVisionRead(request.embeddedText)) {
    return { text: request.embeddedText, legibility: embedded, usedVision: false, attempts: 0, blank: false };
  }

  const { vision, logger } = container();
  if (!vision || !env().VISION_READING_ENABLED) {
    // Without a reader the page keeps whatever text it had; the ingestion
    // metric will record the low legibility rather than pretending it is fine.
    return { text: request.embeddedText, legibility: embedded, usedVision: false, attempts: 0, blank: false };
  }

  let best: PageReadOutcome = {
    text: request.embeddedText,
    legibility: embedded,
    usedVision: false,
    attempts: 0,
    blank: false,
  };

  for (const [index, dpi] of RENDER_SCALES.entries()) {
    const image = await request.renderPage(request.page, dpi);
    if (!image) break;

    const inkRatio = await estimateInkRatio(image);

    try {
      const result = await vision.readPage({
        image,
        mimeType: 'image/png',
        page: request.page,
        documentHint: request.documentHint ?? null,
      });

      await recordVisionUsage({
        workspaceId: request.workspaceId,
        companionId: request.companionId,
        model: result.model,
        usage: result.usage,
        latencyMs: result.latencyMs,
        succeeded: true,
      });

      if (result.blank) {
        return {
          text: '',
          legibility: assessLegibility({ text: '', inkRatio }),
          usedVision: true,
          attempts: index + 1,
          blank: true,
        };
      }

      const legibility = assessLegibility({ text: result.text, inkRatio });
      const outcome: PageReadOutcome = {
        text: result.text,
        legibility,
        usedVision: true,
        attempts: index + 1,
        blank: false,
      };

      if (legibility.score > best.legibility.score) best = outcome;
      // A clean read needs no second attempt; a poor one is retried at a
      // higher resolution before being accepted.
      if (legibility.score >= 0.75) return outcome;
    } catch (error) {
      logger.warn('page read failed', { page: request.page, error });
      await recordVisionUsage({
        workspaceId: request.workspaceId,
        companionId: request.companionId,
        model: vision.visionModel,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        latencyMs: 0,
        succeeded: false,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });
      break;
    }
  }

  return best;
}

/**
 * Proportion of the page that carries ink.
 *
 * This is what makes "the reader returned nothing" distinguishable from "the
 * page really is blank" — the single most important failure to catch, because
 * an empty read looks identical to an empty page in the text alone.
 */
export async function estimateInkRatio(image: Buffer): Promise<number> {
  const sharp = (await import('sharp')).default;
  try {
    const { data, info } = await sharp(image)
      .greyscale()
      // A small thumbnail is enough to measure ink and costs almost nothing.
      .resize({ width: 200, height: 260, fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let inked = 0;
    for (const value of data) {
      if (value < 200) inked += 1;
    }
    return inked / Math.max(info.width * info.height, 1);
  } catch {
    return 0;
  }
}

async function recordVisionUsage(input: {
  workspaceId: string;
  companionId: string;
  model: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number };
  latencyMs: number;
  succeeded: boolean;
  errorCode?: string;
}): Promise<void> {
  const { db, logger } = container();
  try {
    await db.insert(schema.usageLedger).values({
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      provider: 'openai',
      model: input.model,
      requestKind: 'ocr',
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningTokens,
      estimatedCostUsd: estimateCostUsd(input.model, {
        inputTokens: input.usage.inputTokens,
        cachedInputTokens: input.usage.cachedInputTokens,
        outputTokens: input.usage.outputTokens,
      }),
      latencyMs: input.latencyMs,
      succeeded: input.succeeded,
      // Reading a page is an indexing cost, never a customer question.
      billable: false,
      errorCode: input.errorCode ?? null,
      occurredAt: new Date(),
    });
  } catch (error) {
    logger.error('vision usage ledger write failed', { error });
  }
}

export { rasterisePageForOcr as renderPageForReading };
