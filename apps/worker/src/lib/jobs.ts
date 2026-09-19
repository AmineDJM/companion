import type { JobStatus, JobType } from '@companion/shared';
import { and, eq, schema, sql } from '@companion/db';
import { idempotencyKey, PRIORITY, type CompanionJob } from '@companion/queue';
import { container } from '../container.js';

/**
 * Durable job bookkeeping.
 *
 * BullMQ owns scheduling; the `processing_jobs` table owns the record. The row
 * survives a Redis flush, drives the sender's progress screen, and is what the
 * admin Jobs console reads and retries.
 */
export async function markRunning(jobRecordId: string): Promise<void> {
  const { db } = container();
  await db
    .update(schema.processingJobs)
    .set({
      status: 'RUNNING',
      startedAt: new Date(),
      attempts: sql`${schema.processingJobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.processingJobs.id, jobRecordId));
}

export async function markFinished(
  jobRecordId: string,
  status: Extract<JobStatus, 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELED'>,
  error?: string,
): Promise<void> {
  const { db } = container();
  const finishedAt = new Date();

  // Duration is computed in JS rather than in SQL: an untyped bind parameter
  // inside EXTRACT(EPOCH FROM ...) has no inferable type in Postgres.
  const rows = await db
    .select({ startedAt: schema.processingJobs.startedAt, createdAt: schema.processingJobs.createdAt })
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.id, jobRecordId))
    .limit(1);
  const began = rows[0]?.startedAt ?? rows[0]?.createdAt ?? finishedAt;

  await db
    .update(schema.processingJobs)
    .set({
      status,
      finishedAt,
      ...(status === 'COMPLETED' ? { progress: 100 } : {}),
      error: error?.slice(0, 2_000) ?? null,
      durationMs: Math.max(0, finishedAt.getTime() - began.getTime()),
      updatedAt: finishedAt,
    })
    .where(eq(schema.processingJobs.id, jobRecordId));
}

/**
 * A failed attempt that BullMQ will retry. The row goes back to QUEUED with the
 * error recorded, so the admin Jobs console shows "retrying" rather than a
 * permanent failure.
 */
export async function markRetrying(jobRecordId: string, error: string): Promise<void> {
  const { db } = container();
  await db
    .update(schema.processingJobs)
    .set({ status: 'QUEUED', error: error.slice(0, 2_000), updatedAt: new Date() })
    .where(eq(schema.processingJobs.id, jobRecordId));
}

export async function setProgress(jobRecordId: string, progress: number): Promise<void> {
  const { db } = container();
  await db
    .update(schema.processingJobs)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), updatedAt: new Date() })
    .where(eq(schema.processingJobs.id, jobRecordId));
}

/** True when this exact unit of work already completed — the idempotency guard. */
export async function alreadyCompleted(jobRecordId: string): Promise<boolean> {
  const { db } = container();
  const rows = await db
    .select({ status: schema.processingJobs.status })
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.id, jobRecordId))
    .limit(1);
  return rows[0]?.status === 'COMPLETED';
}

export interface ChainOptions {
  priority?: number;
  delayMs?: number;
}

/**
 * Creates the next job record and dispatches it.
 *
 * The idempotency key is deterministic, so a retried parent cannot fan out into
 * duplicate children: the insert conflicts and the dispatch is skipped.
 */
export async function chainJob(
  type: JobType,
  payload: {
    workspaceId: string;
    companionId: string;
    fileId?: string;
    fileVersionId?: string;
    previousVersionId?: string | null;
    depth?: number;
    /**
     * Extra discriminator for jobs that must run once per trigger rather than
     * once per target — finalisation re-checks the whole Companion each time a
     * file completes, so deduping it by companion id would only ever run it for
     * the first file to finish.
     */
    trigger?: string;
  },
  options: ChainOptions = {},
): Promise<string | null> {
  const { db, jobs } = container();
  const key = idempotencyKey(
    type,
    payload.fileVersionId ?? payload.companionId,
    payload.depth ?? null,
    payload.trigger ?? null,
  );

  const [record] = await db
    .insert(schema.processingJobs)
    .values({
      companionId: payload.companionId,
      workspaceId: payload.workspaceId,
      fileId: payload.fileId ?? null,
      fileVersionId: payload.fileVersionId ?? null,
      type,
      idempotencyKey: key,
      status: 'QUEUED',
      priority: options.priority ?? PRIORITY.normal,
      payload: payload.previousVersionId ? { previousVersionId: payload.previousVersionId } : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.processingJobs.id });

  if (!record) return null;

  const job = {
    type,
    jobRecordId: record.id,
    workspaceId: payload.workspaceId,
    companionId: payload.companionId,
    idempotencyKey: key,
    ...(payload.fileId ? { fileId: payload.fileId } : {}),
    ...(payload.fileVersionId ? { fileVersionId: payload.fileVersionId } : {}),
    ...(payload.depth !== undefined ? { depth: payload.depth } : {}),
    ...(payload.previousVersionId !== undefined
      ? { previousVersionId: payload.previousVersionId }
      : {}),
  } as CompanionJob;

  await jobs.enqueue(job, options);
  return record.id;
}

/** Marks a file as failed with a message the sender can actually act on. */
export async function failFile(
  fileId: string,
  message: string,
  status: 'FAILED' | 'UNSUPPORTED' = 'FAILED',
): Promise<void> {
  const { db } = container();
  await db
    .update(schema.files)
    .set({ status, statusMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(schema.files.id, fileId));
}

export async function setFileStatus(
  fileId: string,
  status: 'PROCESSING' | 'READY',
  extra: { pageCount?: number | null } = {},
): Promise<void> {
  const { db } = container();
  await db
    .update(schema.files)
    .set({
      status,
      statusMessage: null,
      ...(extra.pageCount !== undefined ? { pageCount: extra.pageCount } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.files.id, fileId));
}

/** Advances the Companion's build screen without exposing internals. */
export async function updateCompanionProgress(
  companionId: string,
  step: string,
  progress: number,
): Promise<void> {
  const { db } = container();
  await db
    .update(schema.companions)
    .set({
      processingStep: step,
      // Progress only ever moves forward, so concurrent files cannot rewind it.
      processingProgress: sql`GREATEST(${schema.companions.processingProgress}, ${Math.round(progress)})`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.companions.id, companionId), eq(schema.companions.status, 'PROCESSING')),
    );
}
