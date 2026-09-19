import { AppError, generateSlug } from '@companion/shared';
import { and, eq, isNull, schema, sql } from '@companion/db';
import { draftKey } from '@companion/storage';
import { getContainer } from '../container';
import { hashToken, randomToken } from '../crypto';
import { createCompanion } from './companions';
import { storeFileVersion, queueFileProcessing } from './files';
import { loadWorkspaceContext } from './workspace';
import { platformLimits } from './entitlements';

/**
 * Upload drafts.
 *
 * A visitor drops files on the homepage before they have an account. The bytes
 * go into a short-lived draft; signing up claims it and the same objects become
 * a real Companion. Nobody ever uploads the same file twice.
 */
const DRAFT_TTL_HOURS = 24;

export interface DraftHandle {
  id: string;
  token: string;
}

export async function createDraft(name?: string): Promise<DraftHandle> {
  const { db } = getContainer();
  const token = randomToken(24);
  const [row] = await db
    .insert(schema.uploadDrafts)
    .values({
      tokenHash: hashToken(token),
      name: name?.trim() || null,
      expiresAt: new Date(Date.now() + DRAFT_TTL_HOURS * 60 * 60 * 1000),
    })
    .returning({ id: schema.uploadDrafts.id });
  if (!row) throw new AppError('internal_error', 'Could not start the upload.');
  return { id: row.id, token };
}

async function loadDraft(token: string) {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.uploadDrafts)
    .where(
      and(
        eq(schema.uploadDrafts.tokenHash, hashToken(token)),
        isNull(schema.uploadDrafts.claimedAt),
        sql`${schema.uploadDrafts.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Stores one file into a draft.
 *
 * Anonymous uploads are capped hard — by count, by per-file size and by total
 * size — because nobody is accountable for them yet.
 */
export async function addFileToDraft(input: {
  token: string;
  filename: string;
  bytes: Buffer;
  contentType: string;
  relativePath: string;
}): Promise<{ stored: number }> {
  const { db, storage } = getContainer();
  const draft = await loadDraft(input.token);
  if (!draft) throw new AppError('not_found', 'This upload has expired. Please start again.');

  const limits = await platformLimits();
  const ANONYMOUS_MAX_FILES = 25;
  const ANONYMOUS_MAX_BYTES = 200 * 1024 * 1024;

  if (draft.items.length >= ANONYMOUS_MAX_FILES) {
    throw new AppError(
      'quota_exceeded',
      `You can upload up to ${ANONYMOUS_MAX_FILES} files before creating an account.`,
    );
  }
  if (input.bytes.byteLength > Math.min(limits.maxFileBytes, ANONYMOUS_MAX_BYTES)) {
    throw new AppError('file_too_large', `${input.filename} is too large to upload without an account.`);
  }
  if (draft.totalBytes + input.bytes.byteLength > ANONYMOUS_MAX_BYTES) {
    throw new AppError(
      'quota_exceeded',
      'Create an account to continue uploading — your files so far are kept.',
    );
  }

  const key = draftKey({ draftId: draft.id, filename: input.filename });
  await storage.put({
    key,
    body: input.bytes,
    contentType: input.contentType,
    downloadFilename: input.filename,
  });

  await db
    .update(schema.uploadDrafts)
    .set({
      items: sql`${schema.uploadDrafts.items} || ${JSON.stringify([
        {
          filename: input.relativePath || input.filename,
          storageKey: key,
          sizeBytes: input.bytes.byteLength,
          contentType: input.contentType,
        },
      ])}::jsonb`,
      totalBytes: sql`${schema.uploadDrafts.totalBytes} + ${input.bytes.byteLength}`,
    })
    .where(eq(schema.uploadDrafts.id, draft.id));

  return { stored: draft.items.length + 1 };
}

export interface ClaimedDraft {
  companionId: string;
  fileCount: number;
}

/**
 * Turns a claimed draft into a real Companion.
 *
 * The claim is guarded by a conditional update so two concurrent sign-ins on
 * the same draft cannot both create a Companion.
 */
export async function claimDraft(input: {
  token: string;
  workspaceId: string;
  userId: string;
}): Promise<ClaimedDraft | null> {
  const { db, storage, logger } = getContainer();
  const tokenHash = hashToken(input.token);

  const claimedRows = await db
    .update(schema.uploadDrafts)
    .set({ claimedAt: new Date(), claimedByWorkspaceId: input.workspaceId })
    .where(
      and(
        eq(schema.uploadDrafts.tokenHash, tokenHash),
        isNull(schema.uploadDrafts.claimedAt),
        sql`${schema.uploadDrafts.expiresAt} > now()`,
      ),
    )
    .returning();

  const draft = claimedRows[0];
  if (!draft || draft.items.length === 0) return null;

  const workspace = await loadWorkspaceContext(input.workspaceId);
  if (!workspace) return null;

  const companion = await createCompanion({
    workspace,
    userId: input.userId,
    name: draft.name ?? deriveName(draft.items.map((item) => item.filename)),
  });

  let stored = 0;
  for (const [index, item] of draft.items.entries()) {
    try {
      const bytes = await storage.get(item.storageKey);
      const file = await storeFileVersion({
        companion,
        workspaceId: workspace.id,
        userId: input.userId,
        filename: item.filename.split('/').pop() ?? item.filename,
        relativePath: item.filename,
        bytes,
        sortOrder: index,
      });
      if (file.currentVersionId) {
        await queueFileProcessing({
          companionId: companion.id,
          workspaceId: workspace.id,
          fileId: file.id,
          fileVersionId: file.currentVersionId,
          kind: file.kind,
        });
      }
      stored += 1;
      // The draft copy has served its purpose.
      await storage.delete(item.storageKey).catch(() => undefined);
    } catch (error) {
      logger.error('could not adopt draft file', { draftId: draft.id, error });
    }
  }

  await db
    .update(schema.uploadDrafts)
    .set({ claimedCompanionId: companion.id })
    .where(eq(schema.uploadDrafts.id, draft.id));

  await db
    .update(schema.companions)
    .set({ status: 'PROCESSING', processingStep: 'reading', updatedAt: new Date() })
    .where(eq(schema.companions.id, companion.id));

  return { companionId: companion.id, fileCount: stored };
}

function deriveName(filenames: string[]): string {
  const first = filenames[0];
  if (!first) return 'Untitled Companion';
  const base = (first.split('/').pop() ?? first).replace(/\.[^.]+$/, '');
  if (filenames.length === 1) return base.slice(0, 140);
  return `${base.slice(0, 100)} + ${filenames.length - 1} more`;
}

export async function draftSummary(
  token: string,
): Promise<{ name: string | null; fileCount: number; totalBytes: number } | null> {
  const draft = await loadDraft(token);
  if (!draft) return null;
  return { name: draft.name, fileCount: draft.items.length, totalBytes: draft.totalBytes };
}

/** Removes expired, unclaimed drafts and their objects. */
export async function purgeExpiredDrafts(): Promise<number> {
  const { db, storage } = getContainer();
  const expired = await db
    .select()
    .from(schema.uploadDrafts)
    .where(and(isNull(schema.uploadDrafts.claimedAt), sql`${schema.uploadDrafts.expiresAt} <= now()`))
    .limit(200);

  for (const draft of expired) {
    await storage.deleteMany(draft.items.map((item) => item.storageKey)).catch(() => undefined);
    await db.delete(schema.uploadDrafts).where(eq(schema.uploadDrafts.id, draft.id));
  }
  return expired.length;
}

export { generateSlug };
