import { unansweredInsight } from '@companion/ai';
import { and, eq, isNull, schema, sql } from '@companion/db';
import type { ClusterQuestionsJob, FinalizeCompanionJob, PurgeCompanionJob } from '@companion/queue';
import { container } from '../container.js';

/**
 * Finalisation.
 *
 * Runs after every file completes. When nothing is left in flight the Companion
 * flips to ACTIVE, which is the moment the recipient link starts serving
 * content. A Companion whose files all failed is marked FAILED with a message
 * the sender can act on.
 */
export async function handleFinalize(job: FinalizeCompanionJob): Promise<void> {
  const { db } = container();

  const files = await db
    .select({
      id: schema.files.id,
      name: schema.files.name,
      status: schema.files.status,
      statusMessage: schema.files.statusMessage,
      isContainer: schema.files.isContainer,
    })
    .from(schema.files)
    .where(and(eq(schema.files.companionId, job.companionId), isNull(schema.files.removedAt)));

  const inFlight = files.filter(
    (file) => file.status === 'QUEUED' || file.status === 'PROCESSING' || file.status === 'PENDING',
  );
  if (inFlight.length > 0) {
    // Another file is still working; it will re-run this job when it finishes.
    const done = files.length - inFlight.length;
    await db
      .update(schema.companions)
      .set({
        processingProgress: sql`GREATEST(${schema.companions.processingProgress}, ${Math.round((done / Math.max(files.length, 1)) * 90)})`,
        updatedAt: new Date(),
      })
      .where(eq(schema.companions.id, job.companionId));
    return;
  }

  const counts = await db
    .select({
      units: sql<number>`(SELECT count(*)::int FROM ${schema.documentUnits} WHERE ${schema.documentUnits.companionId} = ${job.companionId})`,
      chunks: sql<number>`(SELECT count(*)::int FROM ${schema.chunks} WHERE ${schema.chunks.companionId} = ${job.companionId})`,
      bytes: sql<number>`(SELECT coalesce(sum(${schema.fileVersions.sizeBytes}), 0)::bigint FROM ${schema.fileVersions} WHERE ${schema.fileVersions.companionId} = ${job.companionId})`,
    })
    .from(schema.companions)
    .where(eq(schema.companions.id, job.companionId))
    .limit(1);

  const renderable = files.filter((file) => !file.isContainer);
  const usable = renderable.filter((file) => file.status === 'READY');
  const failures = files.filter((file) => file.status === 'FAILED' || file.status === 'UNSUPPORTED');

  // One malformed file in a hundred-file bundle must not fail the Companion.
  const everythingFailed = renderable.length > 0 && usable.length === 0;
  const nothingUsable = renderable.length === 0 && failures.length > 0;

  const defaultFile = await pickDefaultFile(job.companionId);

  await db
    .update(schema.companions)
    .set({
      status: everythingFailed || nothingUsable ? 'FAILED' : 'ACTIVE',
      processingProgress: 100,
      processingStep: null,
      processingError:
        everythingFailed || nothingUsable
          ? (failures[0]?.statusMessage ?? 'None of the uploaded files could be read.')
          : null,
      indexedUnits: counts[0]?.units ?? 0,
      indexedChunks: counts[0]?.chunks ?? 0,
      storageBytes: Number(counts[0]?.bytes ?? 0),
      fileCount: renderable.length,
      ...(defaultFile ? { defaultFileId: defaultFile } : {}),
      publishedAt: sql`COALESCE(${schema.companions.publishedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.companions.id, job.companionId),
        // Never resurrect a Companion the sender paused or revoked mid-build.
        sql`${schema.companions.status} IN ('PROCESSING', 'DRAFT', 'FAILED')`,
      ),
    );
}

/** Chooses the document a recipient opens first, if the sender has not. */
async function pickDefaultFile(companionId: string): Promise<string | null> {
  const { db } = container();
  const rows = await db
    .select({ defaultFileId: schema.companions.defaultFileId })
    .from(schema.companions)
    .where(eq(schema.companions.id, companionId))
    .limit(1);

  const current = rows[0]?.defaultFileId;
  if (current) {
    const stillValid = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(and(eq(schema.files.id, current), isNull(schema.files.removedAt)))
      .limit(1);
    if (stillValid[0]) return null; // keep the sender's choice
  }

  const candidates = await db
    .select({ id: schema.files.id, kind: schema.files.kind })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.companionId, companionId),
        eq(schema.files.status, 'READY'),
        eq(schema.files.isContainer, false),
        isNull(schema.files.removedAt),
      ),
    )
    .orderBy(schema.files.sortOrder, schema.files.createdAt);

  // A PDF or deck reads better as a landing document than a spreadsheet.
  const preferred =
    candidates.find((file) => file.kind === 'PDF') ??
    candidates.find((file) => file.kind === 'SLIDES' || file.kind === 'WORD') ??
    candidates[0];
  return preferred?.id ?? null;
}

/**
 * Question-topic refinement.
 *
 * Topics are assigned cheaply at ask time; this job only recomputes the
 * unanswered insight and prunes stale examples, so no model is ever called on
 * an analytics page load.
 */
export async function handleClusterQuestions(job: ClusterQuestionsJob): Promise<void> {
  const { db } = container();

  const topics = await db
    .select()
    .from(schema.questionTopics)
    .where(eq(schema.questionTopics.companionId, job.companionId));

  for (const topic of topics) {
    const insight = unansweredInsight({
      label: topic.label,
      questionCount: topic.questionCount,
      unansweredCount: topic.unansweredCount,
      exampleQuestions: topic.exampleQuestions,
    });
    if (insight !== topic.insight) {
      await db
        .update(schema.questionTopics)
        .set({ insight, updatedAt: new Date() })
        .where(eq(schema.questionTopics.id, topic.id));
    }
  }
}

/**
 * Deletion.
 *
 * Runs after the retention window. Chunks and units go first (they are what
 * answers questions), then every stored object is queued for reclamation so
 * nothing is left orphaned in the bucket.
 */
export async function handlePurgeCompanion(job: PurgeCompanionJob): Promise<void> {
  const { db, storage, logger } = container();

  const companion = await db
    .select({
      id: schema.companions.id,
      workspaceId: schema.companions.workspaceId,
      deletedAt: schema.companions.deletedAt,
      purgeAfterAt: schema.companions.purgeAfterAt,
    })
    .from(schema.companions)
    .where(eq(schema.companions.id, job.companionId))
    .limit(1);

  const record = companion[0];
  if (!record?.deletedAt) return; // restored before the window elapsed
  if (record.purgeAfterAt && record.purgeAfterAt.getTime() > Date.now()) return;

  const versions = await db
    .select({ id: schema.fileVersions.id, key: schema.fileVersions.storageKey })
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.companionId, job.companionId));

  const artifacts = await db
    .select({ key: schema.previewArtifacts.storageKey })
    .from(schema.previewArtifacts)
    .where(eq(schema.previewArtifacts.companionId, job.companionId));

  const keys = [...versions.map((version) => version.key), ...artifacts.map((artifact) => artifact.key)].filter(
    (key) => key.length > 0,
  );

  try {
    await storage.deleteMany(keys);
  } catch (error) {
    logger.error('storage purge failed; scheduling reclamation', {
      companionId: job.companionId,
      error,
    });
    if (keys.length > 0) {
      await db
        .insert(schema.storageReclamations)
        .values(
          keys.map((key) => ({
            workspaceId: record.workspaceId,
            storageKey: key,
            reason: 'companion_purge',
            deleteAfterAt: new Date(),
          })),
        )
        .onConflictDoNothing();
    }
  }

  // Cascades remove files, versions, units, chunks, conversations and events.
  await db.delete(schema.companions).where(eq(schema.companions.id, job.companionId));
}
