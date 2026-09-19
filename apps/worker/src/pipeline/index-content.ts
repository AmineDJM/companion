import { chunkUnits, optionsForKind, type ChunkSourceUnit } from '@companion/ai';
import { estimateTokens, estimateCostUsd, EMBEDDING_DIMENSIONS } from '@companion/shared';
import { and, asc, eq, inArray, isNull, schema, sql } from '@companion/db';
import type { ChunkJob, EmbedJob } from '@companion/queue';
import { container } from '../container.js';
import { chainJob, setFileStatus, setProgress, updateCompanionProgress } from '../lib/jobs.js';
import { loadFileVersion } from './ingest.js';

/**
 * Chunking and embedding.
 *
 * Chunks are derived per document unit so they never straddle a page boundary,
 * and each one carries the citation metadata retrieval needs, denormalised so a
 * search needs no joins.
 */
export async function handleChunk(job: ChunkJob): Promise<void> {
  const { db } = container();
  const version = await loadFileVersion(job.fileVersionId);
  if (!version) return;

  await updateCompanionProgress(job.companionId, 'index', 70);
  await setProgress(job.jobRecordId, 25);

  const units = await db
    .select()
    .from(schema.documentUnits)
    .where(eq(schema.documentUnits.fileVersionId, version.fileVersionId))
    .orderBy(asc(schema.documentUnits.ordinal));

  if (units.length === 0) {
    await chainJob('finalize_companion', {
      workspaceId: version.workspaceId,
      companionId: version.companionId,
      trigger: version.fileVersionId,
    });
    return;
  }

  const sources: ChunkSourceUnit[] = units.map((unit) => ({
    unitId: unit.id,
    kind: unit.kind,
    ordinal: unit.ordinal,
    page: unit.page,
    slide: unit.slide,
    sheetName: unit.sheetName,
    range: unit.range,
    sectionTitle: unit.sectionTitle,
    text: unit.text,
  }));

  const chunks = chunkUnits(sources, optionsForKind(version.kind));

  // Carry over embeddings for text that did not change, so replacing one page
  // of a 200-page document does not re-embed the other 199.
  const hashes = chunks.map((chunk) => chunk.contentHash);
  const reusable =
    hashes.length > 0
      ? await db
          .select({
            contentHash: schema.chunks.contentHash,
            embedding: schema.chunks.embedding,
            embeddingModel: schema.chunks.embeddingModel,
          })
          .from(schema.chunks)
          .where(
            and(
              eq(schema.chunks.companionId, version.companionId),
              inArray(schema.chunks.contentHash, hashes),
              sql`${schema.chunks.embedding} IS NOT NULL`,
            ),
          )
      : [];

  const reuseByHash = new Map(
    reusable.map((row) => [row.contentHash, { embedding: row.embedding, model: row.embeddingModel }]),
  );

  await db.transaction(async (tx) => {
    // Replacing the version's chunks wholesale keeps retries idempotent.
    await tx.delete(schema.chunks).where(eq(schema.chunks.fileVersionId, version.fileVersionId));

    if (chunks.length === 0) return;
    await tx.insert(schema.chunks).values(
      chunks.map((chunk) => {
        const reuse = reuseByHash.get(chunk.contentHash);
        return {
          companionId: version.companionId,
          fileId: version.fileId,
          fileVersionId: version.fileVersionId,
          unitId: chunk.unitId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          tokenEstimate: chunk.tokenEstimate,
          fileName: version.filename,
          kind: version.kind,
          page: chunk.page,
          slide: chunk.slide,
          sheetName: chunk.sheetName,
          sectionTitle: chunk.sectionTitle,
          range: chunk.range,
          contentHash: chunk.contentHash,
          embedding: reuse?.embedding ?? null,
          embeddingModel: reuse?.model ?? null,
        };
      }),
    );
  });

  await setProgress(job.jobRecordId, 90);
  await chainJob('embed', {
    workspaceId: version.workspaceId,
    companionId: version.companionId,
    fileId: version.fileId,
    fileVersionId: version.fileVersionId,
  });
}

/** Batch size chosen to stay well inside the embedding API's request limits. */
const EMBED_BATCH = 96;

export async function handleEmbed(job: EmbedJob): Promise<void> {
  const { db, embeddings, logger } = container();
  const version = await loadFileVersion(job.fileVersionId);
  if (!version) return;

  await updateCompanionProgress(job.companionId, 'index', 85);

  if (!embeddings) {
    // Without a provider the Companion still works on keyword search alone.
    logger.warn('no embedding provider; indexing lexically only', { fileId: version.fileId });
    await completeFile(version.fileId, version.fileVersionId);
    await chainJob('finalize_companion', {
      workspaceId: version.workspaceId,
      companionId: version.companionId,
      trigger: version.fileVersionId,
    });
    return;
  }

  const pending = await db
    .select({ id: schema.chunks.id, text: schema.chunks.text })
    .from(schema.chunks)
    .where(
      and(
        eq(schema.chunks.fileVersionId, version.fileVersionId),
        isNull(schema.chunks.embedding),
      ),
    )
    .orderBy(asc(schema.chunks.ordinal));

  let processed = 0;
  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH) {
    const batch = pending.slice(offset, offset + EMBED_BATCH);
    const started = Date.now();

    try {
      const result = await embeddings.embed({ input: batch.map((chunk) => chunk.text) });

      await db.transaction(async (tx) => {
        for (const [index, chunk] of batch.entries()) {
          const vector = result.embeddings[index];
          if (!vector || vector.length !== EMBEDDING_DIMENSIONS) continue;
          await tx
            .update(schema.chunks)
            .set({ embedding: vector, embeddingModel: result.model })
            .where(eq(schema.chunks.id, chunk.id));
        }
      });

      await db.insert(schema.usageLedger).values({
        workspaceId: version.workspaceId,
        companionId: version.companionId,
        provider: embeddings.id,
        model: result.model,
        requestKind: 'embedding',
        inputTokens: result.usage.inputTokens,
        estimatedCostUsd: estimateCostUsd(result.model, {
          inputTokens: result.usage.inputTokens,
        }),
        latencyMs: Date.now() - started,
        succeeded: true,
        // Indexing is a cost of doing business, not a customer question.
        billable: false,
        occurredAt: new Date(),
      });

      processed += batch.length;
      await setProgress(job.jobRecordId, (processed / Math.max(pending.length, 1)) * 100);
    } catch (error) {
      logger.error('embedding batch failed', { fileId: version.fileId, error });
      await db.insert(schema.usageLedger).values({
        workspaceId: version.workspaceId,
        companionId: version.companionId,
        provider: embeddings.id,
        model: embeddings.embeddingModel,
        requestKind: 'embedding',
        inputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started,
        succeeded: false,
        billable: false,
        errorCode: error instanceof Error ? error.name : 'unknown',
        occurredAt: new Date(),
      });
      // Let BullMQ retry the whole job; the reuse-by-hash path makes it cheap.
      throw error;
    }
  }

  await completeFile(version.fileId, version.fileVersionId);
  await chainJob('finalize_companion', {
    workspaceId: version.workspaceId,
    companionId: version.companionId,
    trigger: version.fileVersionId,
  });
}

async function completeFile(fileId: string, fileVersionId: string): Promise<void> {
  const { db } = container();
  await db
    .update(schema.fileVersions)
    .set({ indexedAt: new Date() })
    .where(eq(schema.fileVersions.id, fileVersionId));

  const pageRows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.documentUnits)
    .where(eq(schema.documentUnits.fileVersionId, fileVersionId));

  await setFileStatus(fileId, 'READY', { pageCount: pageRows[0]?.value ?? null });
}

export { estimateTokens };
