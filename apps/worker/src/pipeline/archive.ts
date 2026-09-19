import { dirname } from 'node:path';
import { describeFile } from '@companion/shared';
import { and, eq, schema, sql } from '@companion/db';
import { hashContent, originalKey } from '@companion/storage';
import type { ExtractArchiveJob } from '@companion/queue';
import { container } from '../container.js';
import { ArchiveRejectedError, extractArchive, type ArchiveEntry } from '../lib/archive.js';
import { chainJob, failFile, setProgress, updateCompanionProgress } from '../lib/jobs.js';
import { loadFileVersion, loadPlatformLimits } from './ingest.js';

/**
 * Archive expansion.
 *
 * The archive itself becomes a container row (listed, never rendered) and each
 * safe entry becomes a real file with its folder hierarchy preserved. Nested
 * archives are expanded one level at a time, within the configured depth cap.
 */
export async function handleExtractArchive(job: ExtractArchiveJob): Promise<void> {
  const { db, storage, logger } = container();
  const version = await loadFileVersion(job.fileVersionId);
  if (!version) return;

  await updateCompanionProgress(job.companionId, 'reading', 20);
  await setProgress(job.jobRecordId, 10);

  const limits = await loadPlatformLimits();
  const bytes = await storage.get(version.storageKey);

  let result;
  try {
    result = await extractArchive(bytes, limits, { depth: job.depth });
  } catch (error) {
    const message =
      error instanceof ArchiveRejectedError
        ? error.message
        : 'This archive could not be opened.';
    logger.warn('archive rejected', { fileId: version.fileId, reason: message });
    await failFile(version.fileId, message, 'UNSUPPORTED');
    await chainJob('finalize_companion', {
      workspaceId: version.workspaceId,
      companionId: version.companionId,
      trigger: version.fileVersionId,
    });
    return;
  }

  // The archive row stays as a container so the sender can see what they sent.
  await db
    .update(schema.files)
    .set({
      status: 'READY',
      isContainer: true,
      statusMessage:
        result.rejected.length > 0
          ? `${result.rejected.length} ${result.rejected.length === 1 ? 'item was' : 'items were'} skipped.`
          : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.files.id, version.fileId));

  const total = result.entries.length + result.nestedArchives.length;
  let processed = 0;

  for (const entry of [...result.entries, ...result.nestedArchives]) {
    try {
      await materialiseEntry({
        entry,
        companionId: version.companionId,
        workspaceId: version.workspaceId,
        archiveFileId: version.fileId,
        archiveRootPath: stripExtension(version.filename),
        depth: job.depth,
      });
    } catch (error) {
      logger.error('could not import archive entry', { path: entry.path, error });
    }
    processed += 1;
    await setProgress(job.jobRecordId, 10 + (processed / Math.max(total, 1)) * 85);
  }

  await db
    .update(schema.companions)
    .set({
      fileCount: sql`(SELECT count(*)::int FROM ${schema.files} WHERE ${schema.files.companionId} = ${version.companionId} AND ${schema.files.removedAt} IS NULL AND NOT ${schema.files.isContainer})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.companions.id, version.companionId));

  await chainJob('finalize_companion', {
    workspaceId: version.workspaceId,
    companionId: version.companionId,
    trigger: version.fileVersionId,
  });
}

/** Creates a file + version for one archive entry and queues its processing. */
async function materialiseEntry(input: {
  entry: ArchiveEntry;
  companionId: string;
  workspaceId: string;
  archiveFileId: string;
  archiveRootPath: string;
  depth: number;
}): Promise<void> {
  const { db, storage } = container();
  const relativePath = `${input.archiveRootPath}/${input.entry.path}`;
  const filename = input.entry.path.split('/').pop() ?? input.entry.path;
  const info = describeFile(filename);
  const folderId = await ensureFolderPath(input.companionId, dirname(relativePath));

  const created: { fileId: string; fileVersionId: string } | null = await db.transaction(async (tx) => {
    const [file] = await tx
      .insert(schema.files)
      .values({
        companionId: input.companionId,
        folderId,
        sourceArchiveFileId: input.archiveFileId,
        name: filename,
        path: relativePath,
        kind: info.kind,
        extension: info.extension,
        mimeType: info.mimeType,
        status: 'QUEUED',
        sizeBytes: input.entry.sizeBytes,
        isContainer: info.kind === 'ARCHIVE',
        sortOrder: 1_000,
      })
      .returning({ id: schema.files.id });
    if (!file) return null;

    const [fileVersion] = await tx
      .insert(schema.fileVersions)
      .values({
        fileId: file.id,
        companionId: input.companionId,
        version: 1,
        storageKey: '',
        contentHash: hashContent(input.entry.bytes),
        sizeBytes: input.entry.sizeBytes,
        mimeType: info.mimeType,
        originalFilename: filename,
      })
      .returning({ id: schema.fileVersions.id });
    if (!fileVersion) return null;

    return { fileId: file.id, fileVersionId: fileVersion.id };
  });

  if (!created) return;

  const key = originalKey({
    workspaceId: input.workspaceId,
    companionId: input.companionId,
    fileVersionId: created.fileVersionId,
    filename,
  });
  await storage.put({
    key,
    body: input.entry.bytes,
    contentType: info.mimeType,
    downloadFilename: filename,
  });

  await db
    .update(schema.fileVersions)
    .set({ storageKey: key })
    .where(eq(schema.fileVersions.id, created.fileVersionId));

  await db
    .update(schema.files)
    .set({ currentVersionId: created.fileVersionId, versionCount: 1 })
    .where(eq(schema.files.id, created.fileId));

  if (info.kind === 'ARCHIVE') {
    await chainJob(
      'extract_archive',
      {
        workspaceId: input.workspaceId,
        companionId: input.companionId,
        fileId: created.fileId,
        fileVersionId: created.fileVersionId,
        depth: input.depth + 1,
      },
    );
  } else {
    await chainJob('ingest_upload', {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileId: created.fileId,
      fileVersionId: created.fileVersionId,
    });
  }
}

/** Creates every folder on a path, so the recipient's file drawer mirrors the ZIP. */
async function ensureFolderPath(companionId: string, path: string): Promise<string | null> {
  if (!path || path === '.' || path === '/') return null;
  const { db } = container();
  const segments = path.split('/').filter((segment) => segment.length > 0);

  let parentId: string | null = null;
  let accumulated = '';

  for (const [index, segment] of segments.entries()) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;

    const existing = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(
        and(eq(schema.folders.companionId, companionId), eq(schema.folders.path, accumulated)),
      )
      .limit(1);

    if (existing[0]) {
      parentId = existing[0].id;
      continue;
    }

    const inserted: { id: string }[] = await db
      .insert(schema.folders)
      .values({
        companionId,
        parentId,
        name: segment,
        path: accumulated,
        depth: index,
      })
      .onConflictDoNothing()
      .returning({ id: schema.folders.id });

    const created = inserted[0];
    if (created) {
      parentId = created.id;
    } else {
      // Lost a race with a sibling entry; re-read the winner.
      const raced = await db
        .select({ id: schema.folders.id })
        .from(schema.folders)
        .where(
          and(eq(schema.folders.companionId, companionId), eq(schema.folders.path, accumulated)),
        )
        .limit(1);
      parentId = raced[0]?.id ?? null;
    }
  }

  return parentId;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || filename;
}
