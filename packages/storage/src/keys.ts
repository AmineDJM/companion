import { createHash, randomBytes } from 'node:crypto';

/**
 * Storage key layout.
 *
 * Keys are opaque and unguessable: even if the bucket were briefly misconfigured
 * the key alone should not be enumerable. Originals and derived assets live
 * under separate prefixes so lifecycle rules and cost reporting can target them
 * independently.
 */
export const KEY_PREFIXES = {
  original: 'originals',
  preview: 'previews',
  thumbnail: 'thumbnails',
  text: 'extracted',
  draft: 'drafts',
  branding: 'branding',
} as const;

export function sanitiseKeySegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)
    .toLowerCase();
}

export function originalKey(input: {
  workspaceId: string;
  companionId: string;
  fileVersionId: string;
  filename: string;
}): string {
  const safe = sanitiseKeySegment(input.filename) || 'file';
  return `${KEY_PREFIXES.original}/${input.workspaceId}/${input.companionId}/${input.fileVersionId}/${safe}`;
}

export function draftKey(input: { draftId: string; filename: string }): string {
  const safe = sanitiseKeySegment(input.filename) || 'file';
  return `${KEY_PREFIXES.draft}/${input.draftId}/${randomBytes(8).toString('hex')}-${safe}`;
}

export function normalizedPdfKey(input: { workspaceId: string; fileVersionId: string }): string {
  return `${KEY_PREFIXES.preview}/${input.workspaceId}/${input.fileVersionId}/normalized.pdf`;
}

export function pageImageKey(input: {
  workspaceId: string;
  fileVersionId: string;
  page: number;
}): string {
  const padded = String(input.page).padStart(5, '0');
  return `${KEY_PREFIXES.preview}/${input.workspaceId}/${input.fileVersionId}/pages/${padded}.webp`;
}

export function thumbnailKey(input: { workspaceId: string; fileVersionId: string }): string {
  return `${KEY_PREFIXES.thumbnail}/${input.workspaceId}/${input.fileVersionId}/thumb.webp`;
}

export function sheetPreviewKey(input: { workspaceId: string; fileVersionId: string }): string {
  return `${KEY_PREFIXES.preview}/${input.workspaceId}/${input.fileVersionId}/sheets.json`;
}

export function extractedTextKey(input: { workspaceId: string; fileVersionId: string }): string {
  return `${KEY_PREFIXES.text}/${input.workspaceId}/${input.fileVersionId}/text.json`;
}

export function brandingKey(input: { workspaceId: string; filename: string }): string {
  const safe = sanitiseKeySegment(input.filename) || 'logo';
  return `${KEY_PREFIXES.branding}/${input.workspaceId}/${randomBytes(6).toString('hex')}-${safe}`;
}

/** Everything belonging to one Companion, for cascade deletion. */
export function companionPrefixes(workspaceId: string, companionId: string): string[] {
  return [`${KEY_PREFIXES.original}/${workspaceId}/${companionId}/`];
}

export function hashContent(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}
