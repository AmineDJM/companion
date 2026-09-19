import {
  DEFAULT_PLATFORM_LIMITS,
  describeFile,
  platformLimitsSchema,
  type DocumentKind,
  type PlatformLimits,
} from '@companion/shared';
import { eq, schema } from '@companion/db';
import {
  extractedTextKey,
  normalizedPdfKey,
  pageImageKey,
  sheetPreviewKey,
  thumbnailKey,
} from '@companion/storage';
import type { ConvertPreviewJob, ExtractTextJob, IngestUploadJob } from '@companion/queue';
import { container } from '../container.js';
import { env } from '../env.js';
import {
  convertToPdf,
  makeThumbnail,
  normaliseImage,
  ocrImage,
  rasterisePageForOcr,
  rasterisePdf,
} from '../lib/convert.js';
import { chainJob, failFile, setFileStatus, setProgress, updateCompanionProgress } from '../lib/jobs.js';
import { extractPdf } from '../extractors/pdf.js';
import { extractDocx, extractPptx } from '../extractors/office.js';
import { extractDelimited, extractSpreadsheet, type SheetPreviewModel } from '../extractors/spreadsheet.js';
import { EMPTY_EXTRACTION, type ExtractionResult } from '../extractors/types.js';
import { normaliseWhitespace, splitIntoSections } from '@companion/ai';

/**
 * Ingestion.
 *
 * One file version in, a full set of derived artifacts out: a normalised PDF
 * where needed, page images, a thumbnail, and the document units that chunking
 * and citations are built from.
 */
export async function loadPlatformLimits(): Promise<PlatformLimits> {
  const { db } = container();
  const rows = await db.select().from(schema.platformSettings).limit(1);
  const parsed = platformLimitsSchema.safeParse(rows[0]?.limits);
  return parsed.success ? parsed.data : DEFAULT_PLATFORM_LIMITS;
}

export interface FileVersionContext {
  fileId: string;
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  filename: string;
  kind: DocumentKind;
  storageKey: string;
  sizeBytes: number;
}

export async function loadFileVersion(fileVersionId: string): Promise<FileVersionContext | null> {
  const { db } = container();
  const rows = await db
    .select({
      fileId: schema.fileVersions.fileId,
      fileVersionId: schema.fileVersions.id,
      companionId: schema.fileVersions.companionId,
      storageKey: schema.fileVersions.storageKey,
      sizeBytes: schema.fileVersions.sizeBytes,
      filename: schema.fileVersions.originalFilename,
      kind: schema.files.kind,
      workspaceId: schema.companions.workspaceId,
    })
    .from(schema.fileVersions)
    .innerJoin(schema.files, eq(schema.files.id, schema.fileVersions.fileId))
    .innerJoin(schema.companions, eq(schema.companions.id, schema.fileVersions.companionId))
    .where(eq(schema.fileVersions.id, fileVersionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Stage 1 — read the file and produce a previewable form.
 *
 * Office formats are normalised to PDF so every recipient sees the same layout;
 * PDFs are rasterised so a view-only Companion can serve pictures of pages
 * rather than the source document.
 */
export async function handleIngestUpload(job: IngestUploadJob): Promise<void> {
  const { db, storage, logger } = container();
  const version = await loadFileVersion(job.fileVersionId);
  if (!version) {
    logger.warn('ingest: file version vanished', { fileVersionId: job.fileVersionId });
    return;
  }

  await setFileStatus(version.fileId, 'PROCESSING');
  await updateCompanionProgress(job.companionId, 'reading', 15);
  await setProgress(job.jobRecordId, 10);

  const info = describeFile(version.filename);
  const bytes = await storage.get(version.storageKey);

  let previewPdf: Buffer | null = null;

  if (info.kind === 'PDF') {
    previewPdf = bytes;
  } else if (info.kind === 'IMAGE') {
    const normalised = await normaliseImage(bytes);
    if (normalised) {
      const key = pageImageKey({ workspaceId: version.workspaceId, fileVersionId: version.fileVersionId, page: 1 });
      await storage.put({ key, body: normalised.bytes, contentType: 'image/webp' });
      await recordArtifact({
        fileVersionId: version.fileVersionId,
        companionId: version.companionId,
        kind: 'page_image',
        page: 1,
        storageKey: key,
        mimeType: 'image/webp',
        width: normalised.width,
        height: normalised.height,
        sizeBytes: normalised.bytes.byteLength,
      });
    }
  } else if (info.requiresConversion) {
    await updateCompanionProgress(job.companionId, 'structure', 25);
    previewPdf = await convertToPdf(bytes, version.filename);
    if (previewPdf) {
      const key = normalizedPdfKey({
        workspaceId: version.workspaceId,
        fileVersionId: version.fileVersionId,
      });
      await storage.put({ key, body: previewPdf, contentType: 'application/pdf' });
      await recordArtifact({
        fileVersionId: version.fileVersionId,
        companionId: version.companionId,
        kind: 'normalized_pdf',
        page: null,
        storageKey: key,
        mimeType: 'application/pdf',
        sizeBytes: previewPdf.byteLength,
      });
    } else {
      logger.warn('conversion unavailable; falling back to text-only preview', {
        fileId: version.fileId,
      });
    }
  }

  await setProgress(job.jobRecordId, 45);

  // Rasterise pages: this is what makes "downloads disabled" meaningful.
  if (previewPdf) {
    const limits = await loadPlatformLimits();
    const pages = await rasterisePdf(previewPdf, {
      maxPages: Math.min(limits.maxUnitsPerFile, 500),
    });

    for (const page of pages) {
      const key = pageImageKey({
        workspaceId: version.workspaceId,
        fileVersionId: version.fileVersionId,
        page: page.page,
      });
      await storage.put({ key, body: page.bytes, contentType: 'image/webp' });
      await recordArtifact({
        fileVersionId: version.fileVersionId,
        companionId: version.companionId,
        kind: 'page_image',
        page: page.page,
        storageKey: key,
        mimeType: 'image/webp',
        width: page.width,
        height: page.height,
        sizeBytes: page.bytes.byteLength,
      });
    }

    const cover = pages[0];
    if (cover) {
      const thumbnail = await makeThumbnail(cover.bytes);
      if (thumbnail) {
        const key = thumbnailKey({
          workspaceId: version.workspaceId,
          fileVersionId: version.fileVersionId,
        });
        await storage.put({ key, body: thumbnail, contentType: 'image/webp' });
        await recordArtifact({
          fileVersionId: version.fileVersionId,
          companionId: version.companionId,
          kind: 'thumbnail',
          page: null,
          storageKey: key,
          mimeType: 'image/webp',
          sizeBytes: thumbnail.byteLength,
        });
      }
    }

    if (pages.length > 0) {
      await db
        .update(schema.fileVersions)
        .set({ pageCount: pages.length })
        .where(eq(schema.fileVersions.id, version.fileVersionId));
    }
  }

  await setProgress(job.jobRecordId, 80);
  await chainJob('extract_text', {
    workspaceId: version.workspaceId,
    companionId: version.companionId,
    fileId: version.fileId,
    fileVersionId: version.fileVersionId,
  });
}

/** Stage 2 — turn the file into addressable, citable document units. */
export async function handleExtractText(job: ExtractTextJob): Promise<void> {
  const { db, storage, logger } = container();
  const version = await loadFileVersion(job.fileVersionId);
  if (!version) return;

  await updateCompanionProgress(job.companionId, 'understanding', 55);
  await setProgress(job.jobRecordId, 20);

  const info = describeFile(version.filename);
  const bytes = await storage.get(version.storageKey);
  const limits = await loadPlatformLimits();
  const config = env();

  let result: ExtractionResult = EMPTY_EXTRACTION;
  let preview: SheetPreviewModel | null = null;

  try {
    switch (info.kind) {
      case 'PDF': {
        result = await extractPdf(bytes, {
          maxPages: limits.maxUnitsPerFile,
          ...(config.OCR_ENABLED
            ? {
                ocr: async (page: number) => {
                  const image = await rasterisePageForOcr(bytes, page);
                  if (!image) return null;
                  return ocrImage(image, config.OCR_LANGUAGES);
                },
              }
            : {}),
        });
        break;
      }
      case 'WORD': {
        result = info.extension === 'docx' ? await extractDocx(bytes) : await extractViaPdf(version, limits);
        break;
      }
      case 'SLIDES': {
        result = info.extension === 'pptx' ? await extractPptx(bytes) : await extractViaPdf(version, limits);
        break;
      }
      case 'SPREADSHEET': {
        if (info.extension === 'csv' || info.extension === 'tsv') {
          const extracted = extractDelimited(
            bytes.toString('utf8'),
            info.extension === 'tsv' ? '\t' : ',',
            version.filename,
          );
          result = extracted;
          preview = extracted.preview;
        } else if (info.extension === 'xlsx') {
          const extracted = await extractSpreadsheet(bytes);
          result = extracted;
          preview = extracted.preview;
        } else {
          result = await extractViaPdf(version, limits);
        }
        break;
      }
      case 'TEXT': {
        const text = normaliseWhitespace(bytes.toString('utf8'));
        result = {
          units: splitIntoSections(text).map((section, index) => ({
            kind: 'SECTION' as const,
            ordinal: index + 1,
            page: null,
            slide: null,
            sheetName: null,
            range: null,
            sectionTitle: section.title,
            text: section.text,
          })),
          pageCount: null,
          usedOcr: false,
          notes: [],
        };
        break;
      }
      case 'IMAGE': {
        const recognised = config.OCR_ENABLED ? await ocrImage(bytes, config.OCR_LANGUAGES) : null;
        const text = normaliseWhitespace(recognised ?? '');
        result = {
          units: text
            ? [
                {
                  kind: 'IMAGE' as const,
                  ordinal: 1,
                  page: 1,
                  slide: null,
                  sheetName: null,
                  range: null,
                  sectionTitle: version.filename,
                  text,
                },
              ]
            : [],
          pageCount: 1,
          usedOcr: Boolean(recognised),
          notes: text ? [] : ['No readable text was found in this image.'],
        };
        break;
      }
      default:
        await failFile(version.fileId, 'This file type is not supported.', 'UNSUPPORTED');
        return;
    }
  } catch (error) {
    logger.error('extraction failed', { fileId: version.fileId, error });
    await failFile(version.fileId, 'This file could not be read.');
    return;
  }

  if (preview) {
    const key = sheetPreviewKey({
      workspaceId: version.workspaceId,
      fileVersionId: version.fileVersionId,
    });
    const body = Buffer.from(JSON.stringify(preview));
    await storage.put({ key, body, contentType: 'application/json' });
    await recordArtifact({
      fileVersionId: version.fileVersionId,
      companionId: version.companionId,
      kind: 'sheet_html',
      page: null,
      storageKey: key,
      mimeType: 'application/json',
      sizeBytes: body.byteLength,
    });
  }

  if (result.units.length === 0) {
    // A file with no readable text still renders; it simply is not searchable.
    await db
      .update(schema.files)
      .set({
        status: 'READY',
        statusMessage: result.notes[0] ?? 'No readable text was found in this file.',
        updatedAt: new Date(),
      })
      .where(eq(schema.files.id, version.fileId));
    await chainJob('finalize_companion', {
      workspaceId: version.workspaceId,
      companionId: version.companionId,
      trigger: version.fileVersionId,
    });
    return;
  }

  // Replace units for this version so a retry never duplicates them.
  await db
    .delete(schema.documentUnits)
    .where(eq(schema.documentUnits.fileVersionId, version.fileVersionId));

  const totalCharacters = result.units.reduce((sum, unit) => sum + unit.text.length, 0);

  await db.insert(schema.documentUnits).values(
    result.units.map((unit) => ({
      companionId: version.companionId,
      fileId: version.fileId,
      fileVersionId: version.fileVersionId,
      kind: unit.kind,
      ordinal: unit.ordinal,
      page: unit.page,
      slide: unit.slide,
      sheetName: unit.sheetName,
      sectionTitle: unit.sectionTitle,
      range: unit.range,
      text: unit.text,
      characterCount: unit.text.length,
    })),
  );

  const textKey = extractedTextKey({
    workspaceId: version.workspaceId,
    fileVersionId: version.fileVersionId,
  });
  const textBody = Buffer.from(JSON.stringify({ units: result.units }));
  await storage.put({ key: textKey, body: textBody, contentType: 'application/json' });

  await db
    .update(schema.fileVersions)
    .set({
      usedOcr: result.usedOcr,
      textCharacters: totalCharacters,
      ...(result.pageCount ? { pageCount: result.pageCount } : {}),
    })
    .where(eq(schema.fileVersions.id, version.fileVersionId));

  if (result.notes.length > 0) {
    await db
      .update(schema.files)
      .set({ statusMessage: result.notes.join(' ') })
      .where(eq(schema.files.id, version.fileId));
  }

  await setProgress(job.jobRecordId, 90);
  await chainJob('chunk', {
    workspaceId: version.workspaceId,
    companionId: version.companionId,
    fileId: version.fileId,
    fileVersionId: version.fileVersionId,
  });
}

/** Legacy formats: convert to PDF, then extract from that. */
async function extractViaPdf(
  version: FileVersionContext,
  limits: PlatformLimits,
): Promise<ExtractionResult> {
  const { storage } = container();
  const rows = await container()
    .db.select()
    .from(schema.previewArtifacts)
    .where(eq(schema.previewArtifacts.fileVersionId, version.fileVersionId))
    .limit(20);
  const normalized = rows.find((row) => row.kind === 'normalized_pdf');
  if (!normalized) {
    return { ...EMPTY_EXTRACTION, notes: ['This file could not be converted for reading.'] };
  }
  const pdf = await storage.get(normalized.storageKey);
  return extractPdf(pdf, { maxPages: limits.maxUnitsPerFile });
}

export async function recordArtifact(input: {
  fileVersionId: string;
  companionId: string;
  kind: 'normalized_pdf' | 'page_image' | 'thumbnail' | 'sheet_html' | 'text';
  page: number | null;
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
}): Promise<void> {
  const { db } = container();
  await db
    .insert(schema.previewArtifacts)
    .values({
      fileVersionId: input.fileVersionId,
      companionId: input.companionId,
      kind: input.kind,
      page: input.page,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      width: input.width ?? null,
      height: input.height ?? null,
      sizeBytes: input.sizeBytes,
    })
    // Re-running a stage overwrites the artifact rather than duplicating it.
    .onConflictDoUpdate({
      target: [
        schema.previewArtifacts.fileVersionId,
        schema.previewArtifacts.kind,
        schema.previewArtifacts.page,
      ],
      set: {
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });
}

export type { ConvertPreviewJob };
