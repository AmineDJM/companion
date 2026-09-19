import {
  AppError,
  describeFile,
  isAcceptedFilename,
  looksExecutable,
  signatureMatchesExtension,
  type DocumentKind,
  type FileStatus,
} from '@companion/shared';
import { and, asc, desc, eq, inArray, isNull, schema, sql } from '@companion/db';
import { hashContent, originalKey } from '@companion/storage';
import { idempotencyKey, PRIORITY } from '@companion/queue';
import { getContainer } from '../container';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { effectiveMaxFilesPerCompanion, effectiveMaxUploadBytes } from './entitlements';
import { adjustStorageUsage, assertStorageAvailable } from './quota';
import type { CompanionRecord } from './companions';
import type { WorkspaceContext } from './workspace';

export interface FileRecord {
  id: string;
  companionId: string;
  folderId: string | null;
  name: string;
  path: string;
  kind: DocumentKind;
  extension: string;
  mimeType: string;
  status: FileStatus;
  statusMessage: string | null;
  currentVersionId: string | null;
  versionCount: number;
  sizeBytes: number;
  pageCount: number | null;
  sortOrder: number;
  isContainer: boolean;
  sourceArchiveFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toFileRecord(row: typeof schema.files.$inferSelect): FileRecord {
  return {
    id: row.id,
    companionId: row.companionId,
    folderId: row.folderId,
    name: row.name,
    path: row.path,
    kind: row.kind,
    extension: row.extension,
    mimeType: row.mimeType,
    status: row.status,
    statusMessage: row.statusMessage,
    currentVersionId: row.currentVersionId,
    versionCount: row.versionCount,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    sortOrder: row.sortOrder,
    isContainer: row.isContainer,
    sourceArchiveFileId: row.sourceArchiveFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface UploadedFileInput {
  filename: string;
  bytes: Buffer;
  contentType?: string;
  /** Relative path when the browser reported a dropped folder. */
  relativePath?: string;
}

/**
 * Validates one incoming file before anything is stored.
 *
 * Three independent checks: the extension must be on the accept list, the size
 * must fit both the plan and the platform cap, and the magic bytes must agree
 * with the extension. Extensions are never trusted on their own.
 */
export async function validateUpload(
  file: { filename: string; size: number; header?: Uint8Array },
  workspace: WorkspaceContext,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!isAcceptedFilename(file.filename)) {
    return {
      ok: false,
      code: 'unsupported_file',
      message: `${file.filename} is not a supported file type.`,
    };
  }

  const maxBytes = await effectiveMaxUploadBytes(workspace.entitlements);
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: 'file_too_large',
      message: `${file.filename} is larger than the ${formatMb(maxBytes)} limit for your plan.`,
    };
  }

  if (file.header && file.header.length >= 4) {
    if (looksExecutable(file.header)) {
      return {
        ok: false,
        code: 'unsupported_file',
        message: `${file.filename} looks like a program, not a document.`,
      };
    }
    const info = describeFile(file.filename);
    if (!signatureMatchesExtension(info.extension, file.header)) {
      return {
        ok: false,
        code: 'unsupported_file',
        message: `${file.filename} does not match its file type.`,
      };
    }
  }

  return { ok: true };
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export interface AddFilesResult {
  added: FileRecord[];
  rejected: { filename: string; code: string; message: string }[];
}

/**
 * Stores uploaded files and queues their processing.
 *
 * A malformed file never fails the whole batch: it is recorded as rejected and
 * the remaining files continue, so one bad document in a hundred-file bundle
 * does not cost the sender the upload.
 */
export async function addFilesToCompanion(input: {
  companion: CompanionRecord;
  workspace: WorkspaceContext;
  userId: string;
  files: UploadedFileInput[];
}): Promise<AddFilesResult> {
  const { db } = getContainer();
  const added: FileRecord[] = [];
  const rejected: AddFilesResult['rejected'] = [];

  const maxFiles = await effectiveMaxFilesPerCompanion(input.workspace.entitlements);
  const existingCount = await countFiles(input.companion.id);
  const totalBytes = input.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  await assertStorageAvailable(input.workspace.id, input.workspace.entitlements, totalBytes);

  let sortOrder = existingCount;

  for (const file of input.files) {
    if (existingCount + added.length >= maxFiles) {
      rejected.push({
        filename: file.filename,
        code: 'quota_exceeded',
        message: `Your plan allows ${maxFiles} files in one Companion.`,
      });
      continue;
    }

    const validation = await validateUpload(
      { filename: file.filename, size: file.bytes.byteLength, header: file.bytes.subarray(0, 16) },
      input.workspace,
    );
    if (!validation.ok) {
      rejected.push({ filename: file.filename, code: validation.code, message: validation.message });
      continue;
    }

    try {
      const record = await storeFileVersion({
        companion: input.companion,
        workspaceId: input.workspace.id,
        userId: input.userId,
        filename: file.filename,
        relativePath: file.relativePath ?? file.filename,
        bytes: file.bytes,
        sortOrder: sortOrder++,
      });
      if (record.currentVersionId) {
        await queueFileProcessing({
          companionId: input.companion.id,
          workspaceId: input.workspace.id,
          fileId: record.id,
          fileVersionId: record.currentVersionId,
          kind: record.kind,
          priority: input.workspace.entitlements.priorityProcessing ? PRIORITY.high : PRIORITY.normal,
        });
      }
      added.push(record);
    } catch (error) {
      // The sender must learn which file failed and why, so the real cause is
      // logged with the filename and an actionable message is returned.
      getContainer().logger.error('could not store uploaded file', {
        companionId: input.companion.id,
        filename: file.filename,
        error,
      });
      rejected.push({
        filename: file.filename,
        code: error instanceof AppError ? error.code : 'internal_error',
        message:
          error instanceof AppError
            ? error.message
            : `${file.filename} could not be stored. Try uploading it again.`,
      });
    }
  }

  if (added.length > 0) {
    await db
      .update(schema.companions)
      .set({
        fileCount: sql`(SELECT count(*)::int FROM ${schema.files} WHERE ${schema.files.companionId} = ${input.companion.id} AND ${schema.files.removedAt} IS NULL AND NOT ${schema.files.isContainer})`,
        storageBytes: sql`${schema.companions.storageBytes} + ${added.reduce((sum, file) => sum + file.sizeBytes, 0)}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.companions.id, input.companion.id));

    await adjustStorageUsage(
      input.workspace.id,
      added.reduce((sum, file) => sum + file.sizeBytes, 0),
    );

    await recordAudit({
      action: AUDIT_ACTIONS.fileAdded,
      actorType: 'user',
      actorUserId: input.userId,
      workspaceId: input.workspace.id,
      targetType: 'companion',
      targetId: input.companion.id,
      metadata: { fileCount: added.length },
    });
  }

  return { added, rejected };
}

/**
 * Creates a file (or a new version of an existing one) and uploads the bytes.
 * Content is hashed so replacing a file with identical bytes skips re-indexing
 * entirely.
 */
export async function storeFileVersion(input: {
  companion: CompanionRecord;
  workspaceId: string;
  userId: string | null;
  filename: string;
  relativePath: string;
  bytes: Buffer;
  sortOrder?: number;
  /** Set to create a new version of an existing file instead of a new file. */
  existingFileId?: string;
  folderId?: string | null;
  sourceArchiveFileId?: string | null;
}): Promise<FileRecord> {
  const { db, storage } = getContainer();
  const info = describeFile(input.filename);
  const contentHash = hashContent(input.bytes);
  const isArchive = info.kind === 'ARCHIVE';

  return db.transaction(async (tx) => {
    let fileId = input.existingFileId;
    let previousVersionId: string | null = null;

    if (fileId) {
      const rows = await tx
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, fileId))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new AppError('not_found', 'File not found.');
      previousVersionId = existing.currentVersionId;
    } else {
      const [created] = await tx
        .insert(schema.files)
        .values({
          companionId: input.companion.id,
          folderId: input.folderId ?? null,
          sourceArchiveFileId: input.sourceArchiveFileId ?? null,
          name: input.filename,
          path: input.relativePath,
          kind: info.kind,
          extension: info.extension,
          mimeType: info.mimeType,
          status: 'QUEUED',
          sizeBytes: input.bytes.byteLength,
          sortOrder: input.sortOrder ?? 0,
          isContainer: isArchive,
        })
        .returning({ id: schema.files.id });
      if (!created) throw new AppError('internal_error', 'Could not create the file.');
      fileId = created.id;
    }

    const versionRows = await tx
      .select({ value: sql<number>`coalesce(max(${schema.fileVersions.version}), 0)::int` })
      .from(schema.fileVersions)
      .where(eq(schema.fileVersions.fileId, fileId));
    const nextVersion = (versionRows[0]?.value ?? 0) + 1;

    const [version] = await tx
      .insert(schema.fileVersions)
      .values({
        fileId,
        companionId: input.companion.id,
        version: nextVersion,
        storageKey: '', // filled below once the id is known
        contentHash,
        sizeBytes: input.bytes.byteLength,
        mimeType: info.mimeType,
        originalFilename: input.filename,
        uploadedByUserId: input.userId,
      })
      .returning({ id: schema.fileVersions.id });
    if (!version) throw new AppError('internal_error', 'Could not create the file version.');

    const key = originalKey({
      workspaceId: input.workspaceId,
      companionId: input.companion.id,
      fileVersionId: version.id,
      filename: input.filename,
    });

    // Upload before committing: a committed row pointing at a missing object
    // would be worse than a failed transaction.
    await storage.put({
      key,
      body: input.bytes,
      contentType: info.mimeType,
      downloadFilename: input.filename,
    });

    await tx
      .update(schema.fileVersions)
      .set({ storageKey: key })
      .where(eq(schema.fileVersions.id, version.id));

    if (previousVersionId) {
      await tx
        .update(schema.fileVersions)
        .set({ supersededAt: new Date() })
        .where(eq(schema.fileVersions.id, previousVersionId));
    }

    const [updated] = await tx
      .update(schema.files)
      .set({
        currentVersionId: version.id,
        versionCount: nextVersion,
        status: 'QUEUED',
        statusMessage: null,
        sizeBytes: input.bytes.byteLength,
        name: input.filename,
        kind: info.kind,
        extension: info.extension,
        mimeType: info.mimeType,
        updatedAt: new Date(),
      })
      .where(eq(schema.files.id, fileId))
      .returning();
    if (!updated) throw new AppError('internal_error', 'Could not update the file.');

    return toFileRecord(updated);
  });
}

/**
 * Queues the processing pipeline for a file version.
 *
 * Archives go through extraction first; everything else starts at ingestion.
 * Each job row is created before dispatch so progress survives a Redis flush.
 */
export async function queueFileProcessing(input: {
  companionId: string;
  workspaceId: string;
  fileId: string;
  fileVersionId: string;
  kind: DocumentKind;
  priority?: number;
  previousVersionId?: string | null;
}): Promise<string | null> {
  const { db, jobs, logger } = getContainer();
  const type = input.kind === 'ARCHIVE' ? 'extract_archive' : 'ingest_upload';
  const key = idempotencyKey(type, input.fileVersionId);

  const [record] = await db
    .insert(schema.processingJobs)
    .values({
      companionId: input.companionId,
      workspaceId: input.workspaceId,
      fileId: input.fileId,
      fileVersionId: input.fileVersionId,
      type,
      idempotencyKey: key,
      status: 'QUEUED',
      priority: input.priority ?? PRIORITY.normal,
      payload: input.previousVersionId ? { previousVersionId: input.previousVersionId } : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.processingJobs.id });

  if (!record) return null; // already queued for this exact version

  if (!jobs) {
    logger.warn('no queue configured; file processing deferred', { fileId: input.fileId });
    return record.id;
  }

  await jobs.enqueue(
    type === 'extract_archive'
      ? {
          type: 'extract_archive',
          jobRecordId: record.id,
          workspaceId: input.workspaceId,
          companionId: input.companionId,
          fileId: input.fileId,
          fileVersionId: input.fileVersionId,
          idempotencyKey: key,
          depth: 1,
        }
      : {
          type: 'ingest_upload',
          jobRecordId: record.id,
          workspaceId: input.workspaceId,
          companionId: input.companionId,
          fileId: input.fileId,
          fileVersionId: input.fileVersionId,
          idempotencyKey: key,
        },
    { priority: input.priority ?? PRIORITY.normal },
  );

  return record.id;
}

export async function listFiles(
  companionId: string,
  options: { includeRemoved?: boolean } = {},
): Promise<FileRecord[]> {
  const { db } = getContainer();
  const conditions = [eq(schema.files.companionId, companionId)];
  if (!options.includeRemoved) conditions.push(isNull(schema.files.removedAt));
  const rows = await db
    .select()
    .from(schema.files)
    .where(and(...conditions))
    .orderBy(asc(schema.files.sortOrder), asc(schema.files.createdAt));
  return rows.map(toFileRecord);
}

export async function getFile(fileId: string, companionId?: string): Promise<FileRecord | null> {
  const { db } = getContainer();
  const conditions = [eq(schema.files.id, fileId)];
  if (companionId) conditions.push(eq(schema.files.companionId, companionId));
  const rows = await db
    .select()
    .from(schema.files)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ? toFileRecord(rows[0]) : null;
}

export async function countFiles(companionId: string): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.files)
    .where(and(eq(schema.files.companionId, companionId), isNull(schema.files.removedAt)));
  return rows[0]?.value ?? 0;
}

/** Soft-removes a file and its index entries. The share link does not change. */
export async function removeFile(input: {
  companion: CompanionRecord;
  file: FileRecord;
  userId: string;
}): Promise<void> {
  const { db } = getContainer();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.files)
      .set({ removedAt: now, status: 'REMOVED', updatedAt: now })
      .where(eq(schema.files.id, input.file.id));

    // Retrieval must stop immediately; the objects are reclaimed later.
    await tx.delete(schema.chunks).where(eq(schema.chunks.fileId, input.file.id));
    await tx.delete(schema.documentUnits).where(eq(schema.documentUnits.fileId, input.file.id));

    await tx
      .update(schema.companions)
      .set({
        fileCount: sql`GREATEST(${schema.companions.fileCount} - 1, 0)`,
        storageBytes: sql`GREATEST(${schema.companions.storageBytes} - ${input.file.sizeBytes}, 0)`,
        defaultFileId: sql`CASE WHEN ${schema.companions.defaultFileId} = ${input.file.id} THEN NULL ELSE ${schema.companions.defaultFileId} END`,
        updatedAt: now,
      })
      .where(eq(schema.companions.id, input.companion.id));
  });

  await adjustStorageUsage(input.companion.workspaceId, -input.file.sizeBytes);
  await scheduleStorageReclamation(input.file.id, input.companion.workspaceId);

  await recordAudit({
    action: AUDIT_ACTIONS.fileRemoved,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.companion.workspaceId,
    targetType: 'file',
    targetId: input.file.id,
    targetLabel: input.file.name,
  });
}

/** Queues deletion of every stored object for a file. Nothing is orphaned. */
async function scheduleStorageReclamation(fileId: string, workspaceId: string): Promise<void> {
  const { db } = getContainer();
  const versions = await db
    .select({ id: schema.fileVersions.id, key: schema.fileVersions.storageKey, size: schema.fileVersions.sizeBytes })
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.fileId, fileId));
  if (versions.length === 0) return;

  const artifacts = await db
    .select({ key: schema.previewArtifacts.storageKey, size: schema.previewArtifacts.sizeBytes })
    .from(schema.previewArtifacts)
    .where(
      inArray(
        schema.previewArtifacts.fileVersionId,
        versions.map((version) => version.id),
      ),
    );

  const deleteAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const rows = [
    ...versions.map((version) => ({ storageKey: version.key, sizeBytes: version.size })),
    ...artifacts.map((artifact) => ({ storageKey: artifact.key, sizeBytes: artifact.size })),
  ].filter((row) => row.storageKey.length > 0);

  if (rows.length === 0) return;
  await db
    .insert(schema.storageReclamations)
    .values(
      rows.map((row) => ({
        workspaceId,
        storageKey: row.storageKey,
        sizeBytes: row.sizeBytes,
        reason: 'file_removed',
        deleteAfterAt: deleteAfter,
      })),
    )
    .onConflictDoNothing();
}

export interface FileVersionRecord {
  id: string;
  fileId: string;
  version: number;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
  pageCount: number | null;
  indexedAt: Date | null;
  usedOcr: boolean;
  supersededAt: Date | null;
  createdAt: Date;
}

export async function getCurrentVersion(fileId: string): Promise<FileVersionRecord | null> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.fileVersions)
    .where(and(eq(schema.fileVersions.fileId, fileId), isNull(schema.fileVersions.supersededAt)))
    .orderBy(desc(schema.fileVersions.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function listVersions(fileId: string): Promise<FileVersionRecord[]> {
  const { db } = getContainer();
  return db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.fileId, fileId))
    .orderBy(desc(schema.fileVersions.version));
}
