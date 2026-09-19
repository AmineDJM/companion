import {
  compareGeometry,
  hammingDistance,
  perceptualHash,
  structuralSimilarity,
  textConsistency,
} from '@companion/quality';
import { asc, eq, schema } from '@companion/db';
import { container } from '../container.js';
import { env } from '../env.js';
import {
  greyscaleRaw,
  rasterisePageForOcr,
  renderReferencePage,
  type RasterisedPage,
} from '../lib/convert.js';
import { readPage } from '../lib/page-reader.js';
import { measure } from '../lib/quality.js';

/**
 * Preview fidelity.
 *
 * With downloads disabled the page image *is* the document, so "the preview
 * rendered" is not the same claim as "the preview shows the page". Each sampled
 * page is compared against a lossless reference render of the same page:
 * structure by SSIM, shape by aspect ratio, and identity by perceptual hash so
 * a page served under the wrong number is caught rather than assumed away.
 */

/** Pages compared per file. Comparison is CPU-bound, so the sample is small. */
const SAMPLE_PAGES = 3;
/** Above this Hamming distance two page renders are not the same page. */
const IDENTITY_DISTANCE = 12;

function samplePages(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, index) => index + 1);
  // First, middle and last: the pages where truncation and ordering bugs show.
  const step = (count - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => Math.round(1 + index * step));
}

export async function measurePreviewFidelity(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
  sourcePdf: Buffer;
  pages: RasterisedPage[];
}): Promise<void> {
  if (input.pages.length === 0) return;
  const { logger } = container();

  const context = {
    workspaceId: input.workspaceId,
    companionId: input.companionId,
    fileVersionId: input.fileVersionId,
  };
  const byNumber = new Map(input.pages.map((page) => [page.page, page]));
  const targets = samplePages(input.pages.length, SAMPLE_PAGES);

  const similarities: number[] = [];
  const deviations: number[] = [];
  const references = new Map<number, { hash: bigint; width: number; height: number }>();
  let inversions = 0;
  let compared = 0;

  for (const pageNumber of targets) {
    const delivered = byNumber.get(pageNumber);
    if (!delivered) {
      // A page the viewer will ask for and never receive.
      inversions += 1;
      continue;
    }

    let reference: Awaited<ReturnType<typeof renderReferencePage>>;
    try {
      reference = await renderReferencePage(input.sourcePdf, pageNumber);
    } catch (error) {
      logger.warn('reference render failed', { fileVersionId: input.fileVersionId, error });
      continue;
    }
    if (!reference) continue;

    const size = { width: delivered.width, height: delivered.height };
    const [deliveredImage, referenceImage] = await Promise.all([
      greyscaleRaw(delivered.bytes, size),
      greyscaleRaw(reference.bytes, size),
    ]);
    if (!deliveredImage || !referenceImage) continue;

    compared += 1;
    similarities.push(structuralSimilarity(referenceImage, deliveredImage));

    const geometry = compareGeometry(
      { width: reference.width, height: reference.height },
      { width: delivered.width, height: delivered.height },
    );
    deviations.push(geometry.deviation);
    if (!geometry.orientationMatches) inversions += 1;

    const referenceHash = perceptualHash(referenceImage);
    references.set(pageNumber, {
      hash: referenceHash,
      width: reference.width,
      height: reference.height,
    });
    if (hammingDistance(referenceHash, perceptualHash(deliveredImage)) > IDENTITY_DISTANCE) {
      // The delivered image does not depict the page it is filed under.
      inversions += 1;
    }
  }

  if (compared === 0) return;

  const evidence = {
    fileName: input.fileName,
    previewPages: input.pages.length,
    comparedPages: targets,
    identityDistanceThreshold: IDENTITY_DISTANCE,
  };

  await measure(
    'viewer.preview_fidelity',
    { value: Math.min(...similarities), sampleSize: compared, evidence },
    context,
  );
  await measure(
    'viewer.geometry_deviation',
    { value: Math.max(...deviations), sampleSize: compared, evidence },
    context,
  );
  await measure(
    'viewer.page_order_inversions',
    { value: inversions, sampleSize: compared, evidence },
    context,
  );
}

/**
 * Preview text consistency.
 *
 * The recipient reads the image; the model reads the extracted text. If those
 * two disagree, an answer can be perfectly grounded in text that is nowhere on
 * the page the reader is looking at. Only pages whose embedded text was trusted
 * are sampled — a page already read by vision has been checked by definition —
 * and only one per file, because this costs a provider call.
 */
export async function measurePreviewTextConsistency(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
  sourcePdf: Buffer;
}): Promise<void> {
  const config = env();
  const { db, vision } = container();
  if (!vision || !config.VISION_READING_ENABLED || !config.PREVIEW_TEXT_AUDIT_ENABLED) return;

  const units = await db
    .select({ page: schema.documentUnits.page, text: schema.documentUnits.text })
    .from(schema.documentUnits)
    .where(eq(schema.documentUnits.fileVersionId, input.fileVersionId))
    .orderBy(asc(schema.documentUnits.ordinal));

  // A page with very little text yields a meaningless overlap ratio.
  const candidate = units.find((unit) => unit.page !== null && unit.text.length >= 200);
  if (!candidate?.page) return;

  const outcome = await readPage({
    // Forcing the read is the point: the comparison needs an independent
    // transcription of the image, not the text that is being audited.
    embeddedText: '',
    page: candidate.page,
    renderPage: (target, dpi) => rasterisePageForOcr(input.sourcePdf, target, dpi),
    documentHint: 'document',
    workspaceId: input.workspaceId,
    companionId: input.companionId,
  });
  if (!outcome.usedVision || outcome.blank) return;

  await measure(
    'viewer.preview_text_consistency',
    {
      value: textConsistency(candidate.text, outcome.text),
      sampleSize: 1,
      evidence: {
        fileName: input.fileName,
        page: candidate.page,
        extractedCharacters: candidate.text.length,
        transcribedCharacters: outcome.text.length,
        legibility: outcome.legibility.score,
      },
    },
    {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileVersionId: input.fileVersionId,
    },
  );
}
