import { AppError } from '@companion/shared';
import { and, asc, eq, schema } from '@companion/db';
import { getContainer } from '../container';
import type { CompanionRecord } from './companions';

/**
 * Secure preview resolution.
 *
 * With downloads disabled, the browser must never receive a URL that points at
 * the original file. Recipients are served derived artifacts (page images, a
 * normalised PDF, a sheet model) through an authorising route that re-checks
 * access on every request and streams the bytes itself.
 */
export interface PreviewDescriptor {
  kind: 'page_images' | 'pdf' | 'sheets' | 'image' | 'text' | 'unavailable';
  pageCount: number;
  /** Route path the viewer fetches. Never a storage URL. */
  baseUrl: string;
  mimeType: string;
}

export async function describePreview(input: {
  companion: CompanionRecord;
  fileId: string;
}): Promise<PreviewDescriptor> {
  const { db } = getContainer();
  const fileRows = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, input.fileId), eq(schema.files.companionId, input.companion.id)))
    .limit(1);
  const file = fileRows[0];
  if (!file || file.removedAt) throw new AppError('not_found', 'File not found.');
  if (!file.currentVersionId) throw new AppError('companion_not_ready', 'This file is still being prepared.');

  const artifacts = await db
    .select({ kind: schema.previewArtifacts.kind, page: schema.previewArtifacts.page })
    .from(schema.previewArtifacts)
    .where(eq(schema.previewArtifacts.fileVersionId, file.currentVersionId))
    .orderBy(asc(schema.previewArtifacts.page));

  const base = `/api/c/${input.companion.slug}/files/${file.id}`;
  const pageImages = artifacts.filter((artifact) => artifact.kind === 'page_image');

  // Page images are the preferred form: they never expose the source document.
  if (pageImages.length > 0) {
    return {
      kind: 'page_images',
      pageCount: pageImages.length,
      baseUrl: base,
      mimeType: 'image/webp',
    };
  }

  if (artifacts.some((artifact) => artifact.kind === 'sheet_html')) {
    return { kind: 'sheets', pageCount: 1, baseUrl: base, mimeType: 'application/json' };
  }

  if (file.kind === 'IMAGE') {
    return { kind: 'image', pageCount: 1, baseUrl: base, mimeType: file.mimeType };
  }

  if (
    file.kind === 'PDF' ||
    artifacts.some((artifact) => artifact.kind === 'normalized_pdf')
  ) {
    // Streamed through the guarded route; still not a public object URL.
    return {
      kind: 'pdf',
      pageCount: file.pageCount ?? 1,
      baseUrl: base,
      mimeType: 'application/pdf',
    };
  }

  if (file.kind === 'TEXT' || file.kind === 'SPREADSHEET') {
    return { kind: 'text', pageCount: 1, baseUrl: base, mimeType: 'text/plain' };
  }

  return { kind: 'unavailable', pageCount: 0, baseUrl: base, mimeType: 'application/octet-stream' };
}

export interface ResolvedArtifact {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

/** The object to stream for a given file and optional page. */
export async function resolveArtifact(input: {
  companionId: string;
  fileId: string;
  page: number | null;
  /** When true, resolve the original file rather than a derived preview. */
  original: boolean;
}): Promise<ResolvedArtifact & { filename: string }> {
  const { db } = getContainer();
  const fileRows = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, input.fileId), eq(schema.files.companionId, input.companionId)))
    .limit(1);
  const file = fileRows[0];
  if (!file || file.removedAt || !file.currentVersionId) {
    throw new AppError('not_found', 'File not found.');
  }

  const versionRows = await db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.id, file.currentVersionId))
    .limit(1);
  const version = versionRows[0];
  if (!version) throw new AppError('not_found', 'File not found.');

  if (input.original) {
    return {
      storageKey: version.storageKey,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      filename: file.name,
    };
  }

  if (input.page !== null) {
    const pageRows = await db
      .select()
      .from(schema.previewArtifacts)
      .where(
        and(
          eq(schema.previewArtifacts.fileVersionId, version.id),
          eq(schema.previewArtifacts.kind, 'page_image'),
          eq(schema.previewArtifacts.page, input.page),
        ),
      )
      .limit(1);
    const artifact = pageRows[0];
    if (!artifact) throw new AppError('not_found', 'That page is not available.');
    return {
      storageKey: artifact.storageKey,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      filename: `${file.name} p${input.page}`,
    };
  }

  // Prefer the normalised PDF so Office formats render identically for everyone.
  const normalizedRows = await db
    .select()
    .from(schema.previewArtifacts)
    .where(
      and(
        eq(schema.previewArtifacts.fileVersionId, version.id),
        eq(schema.previewArtifacts.kind, 'normalized_pdf'),
      ),
    )
    .limit(1);
  const normalized = normalizedRows[0];
  if (normalized) {
    return {
      storageKey: normalized.storageKey,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
      filename: file.name,
    };
  }

  const sheetRows = await db
    .select()
    .from(schema.previewArtifacts)
    .where(
      and(
        eq(schema.previewArtifacts.fileVersionId, version.id),
        eq(schema.previewArtifacts.kind, 'sheet_html'),
      ),
    )
    .limit(1);
  const sheets = sheetRows[0];
  if (sheets) {
    return {
      storageKey: sheets.storageKey,
      mimeType: sheets.mimeType,
      sizeBytes: sheets.sizeBytes,
      filename: file.name,
    };
  }

  // PDFs and images are already in a renderable form.
  if (file.kind === 'PDF' || file.kind === 'IMAGE') {
    return {
      storageKey: version.storageKey,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      filename: file.name,
    };
  }

  throw new AppError('companion_not_ready', 'A preview for this file is not ready yet.');
}
