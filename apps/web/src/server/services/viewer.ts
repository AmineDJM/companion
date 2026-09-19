import { AppError, type Branding, type CompanionStatus, type DocumentKind } from '@companion/shared';
import { and, asc, eq, isNull, schema } from '@companion/db';
import { getContainer } from '../container';
import { describePreview, type PreviewDescriptor } from './previews';
import type { CompanionRecord } from './companions';

/**
 * The payload the recipient viewer renders from.
 *
 * Deliberately narrow: it contains what is needed to display the document and
 * navigate the bundle, and nothing about the sender's workspace, plan or
 * analytics.
 */
export interface ViewerFile {
  id: string;
  name: string;
  path: string;
  kind: DocumentKind;
  folderPath: string | null;
  pageCount: number | null;
  sizeBytes: number;
  ready: boolean;
  statusMessage: string | null;
}

export interface ViewerPayload {
  slug: string;
  name: string;
  status: CompanionStatus;
  senderLabel: string;
  branding: Branding;
  downloadAllowed: boolean;
  aiEnabled: boolean;
  expiresAt: string | null;
  files: ViewerFile[];
  folders: { path: string; name: string; depth: number }[];
  activeFileId: string | null;
  preview: PreviewDescriptor | null;
  /** True when the sender has more than one readable document. */
  multiFile: boolean;
}

export async function buildViewerPayload(
  companion: CompanionRecord,
  requestedFileId?: string | null,
): Promise<ViewerPayload> {
  const { db } = getContainer();

  const [fileRows, folderRows, workspaceRows] = await Promise.all([
    db
      .select({
        id: schema.files.id,
        name: schema.files.name,
        path: schema.files.path,
        kind: schema.files.kind,
        status: schema.files.status,
        statusMessage: schema.files.statusMessage,
        pageCount: schema.files.pageCount,
        sizeBytes: schema.files.sizeBytes,
        isContainer: schema.files.isContainer,
        folderPath: schema.folders.path,
      })
      .from(schema.files)
      .leftJoin(schema.folders, eq(schema.folders.id, schema.files.folderId))
      .where(and(eq(schema.files.companionId, companion.id), isNull(schema.files.removedAt)))
      .orderBy(asc(schema.files.sortOrder), asc(schema.files.path)),
    db
      .select({
        path: schema.folders.path,
        name: schema.folders.name,
        depth: schema.folders.depth,
      })
      .from(schema.folders)
      .where(eq(schema.folders.companionId, companion.id))
      .orderBy(asc(schema.folders.path)),
    db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, companion.workspaceId))
      .limit(1),
  ]);

  // Archives are listed as folders, not as openable documents.
  const files: ViewerFile[] = fileRows
    .filter((row) => !row.isContainer)
    .map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      kind: row.kind,
      folderPath: row.folderPath,
      pageCount: row.pageCount,
      sizeBytes: row.sizeBytes,
      ready: row.status === 'READY',
      statusMessage: row.statusMessage,
    }));

  const readable = files.filter((file) => file.ready);
  const requested = requestedFileId
    ? readable.find((file) => file.id === requestedFileId)
    : undefined;
  const active =
    requested ??
    readable.find((file) => file.id === companion.defaultFileId) ??
    readable[0] ??
    null;

  const preview = active ? await describePreview({ companion, fileId: active.id }).catch(() => null) : null;

  return {
    slug: companion.slug,
    name: companion.name,
    status: companion.effectiveStatus,
    senderLabel: companion.branding.senderLabel ?? workspaceRows[0]?.name ?? 'Companion',
    branding: companion.branding,
    downloadAllowed: companion.downloadAllowed,
    aiEnabled: companion.aiEnabled,
    expiresAt: companion.expiresAt?.toISOString() ?? null,
    files,
    folders: folderRows,
    activeFileId: active?.id ?? null,
    preview,
    multiFile: files.length > 1,
  };
}

/**
 * Resolves a citation to a viewer location. Always targets the version
 * currently being served, so an answer never links into stale content.
 */
export async function resolveCitationTarget(input: {
  companionId: string;
  fileId: string;
  page: number | null;
}): Promise<{ fileId: string; page: number | null } | null> {
  const { db } = getContainer();
  const rows = await db
    .select({ id: schema.files.id, pageCount: schema.files.pageCount })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, input.fileId),
        eq(schema.files.companionId, input.companionId),
        isNull(schema.files.removedAt),
      ),
    )
    .limit(1);

  const file = rows[0];
  if (!file) return null;
  const page =
    input.page !== null && file.pageCount !== null
      ? Math.min(Math.max(input.page, 1), file.pageCount)
      : input.page;
  return { fileId: file.id, page };
}

export function assertViewerReady(payload: ViewerPayload): void {
  if (payload.files.length === 0) {
    throw new AppError('companion_not_ready', 'This document is still being prepared.');
  }
}
