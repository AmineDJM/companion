import { createHash } from 'node:crypto';
import { chunkStatistics, measureCoverage } from '@companion/quality';
import { EMBEDDING_DIMENSIONS } from '@companion/shared';
import { and, eq, isNull, schema, sql } from '@companion/db';
import { container } from '../container.js';
import { measure } from '../lib/quality.js';

/**
 * Ingestion fidelity.
 *
 * The product promises that a shared document is complete and searchable. This
 * module proves it, or records precisely how it fell short: bytes verified
 * against their upload digest, structural units counted against what the
 * container itself declares, preview pages counted against parsed pages, and
 * every character of extracted text checked for reachability through the index.
 *
 * Nothing here asks a model whether the result looks right.
 */

/** Bumped whenever the pipeline's output would differ for the same input. */
export const PROCESSING_VERSION = '1.0.0';

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Verifies that the bytes the worker read are the bytes that were uploaded.
 *
 * A successful HTTP upload is not evidence that an object stored correctly;
 * this is the only thing that is.
 */
export async function verifyDownloadIntegrity(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  expectedHash: string;
  bytes: Buffer;
  storageKey: string;
}): Promise<boolean> {
  const observed = sha256(input.bytes);
  const matches = observed === input.expectedHash;

  await measure(
    'ingestion.upload_hash_match',
    {
      value: matches ? 1 : 0,
      evidence: {
        storageKey: input.storageKey,
        expectedHash: input.expectedHash,
        observedHash: observed,
        sizeBytes: input.bytes.byteLength,
      },
    },
    {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileVersionId: input.fileVersionId,
    },
  );

  const { db } = container();
  await db
    .update(schema.fileVersions)
    .set({ verifiedHashAt: new Date() })
    .where(eq(schema.fileVersions.id, input.fileVersionId));

  await db.insert(schema.storageIntegrityChecks).values({
    storageKey: input.storageKey,
    workspaceId: input.workspaceId,
    fileVersionId: input.fileVersionId,
    expectedSizeBytes: input.bytes.byteLength,
    observedSizeBytes: input.bytes.byteLength,
    expectedHash: input.expectedHash,
    observedHash: observed,
    outcome: matches ? 'ok' : 'hash_mismatch',
    deepVerified: true,
    checkedAt: new Date(),
  });

  return matches;
}

/**
 * Structural fidelity: every page, slide or sheet the source declares must be
 * present in the parsed document. A silently dropped page is the failure this
 * exists to catch, because nothing downstream would ever notice it.
 */
export async function recordStructuralFidelity(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
  declaredUnits: number | null;
  parsedUnits: number;
  blankUnits: number;
  lowConfidenceUnits: number[];
}): Promise<void> {
  const { db } = container();

  await db
    .update(schema.fileVersions)
    .set({
      declaredUnits: input.declaredUnits,
      parsedUnits: input.parsedUnits,
      lowConfidenceUnits: input.lowConfidenceUnits,
      processingVersion: PROCESSING_VERSION,
    })
    .where(eq(schema.fileVersions.id, input.fileVersionId));

  if (input.declaredUnits && input.declaredUnits > 0) {
    // A page the reader confirmed is blank is accounted for, not missing.
    const accounted = input.parsedUnits + input.blankUnits;
    await measure(
      'ingestion.structural_fidelity',
      {
        value: Math.min(accounted / input.declaredUnits, 1),
        sampleSize: input.declaredUnits,
        evidence: {
          fileName: input.fileName,
          declaredUnits: input.declaredUnits,
          parsedUnits: input.parsedUnits,
          blankUnits: input.blankUnits,
          missingUnits: Math.max(input.declaredUnits - accounted, 0),
        },
      },
      {
        workspaceId: input.workspaceId,
        companionId: input.companionId,
        fileVersionId: input.fileVersionId,
      },
    );
  }

  for (const page of input.lowConfidenceUnits) {
    await measure(
      'ingestion.vision_read_confidence',
      {
        // The page-level score is recorded by the reader; this row marks the
        // page as one that needed help and did not get clean text.
        value: 0.5,
        evidence: { fileName: input.fileName, page },
      },
      {
        workspaceId: input.workspaceId,
        companionId: input.companionId,
        fileVersionId: input.fileVersionId,
      },
    );
  }
}

/** Preview pages must match parsed pages exactly, or a page is unreachable. */
export async function recordPreviewParity(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
  parsedPages: number;
  previewPages: number;
}): Promise<void> {
  if (input.parsedPages === 0) return;
  const { db } = container();

  await db
    .update(schema.fileVersions)
    .set({ previewUnits: input.previewPages })
    .where(eq(schema.fileVersions.id, input.fileVersionId));

  await measure(
    'ingestion.preview_page_parity',
    {
      value: Math.min(input.previewPages / input.parsedPages, 1),
      sampleSize: input.parsedPages,
      evidence: {
        fileName: input.fileName,
        parsedPages: input.parsedPages,
        previewPages: input.previewPages,
      },
    },
    {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileVersionId: input.fileVersionId,
    },
  );
}

/**
 * Index coverage: could a reader ask about any part of this document and have
 * it found? Text that falls between two chunk boundaries is invisible to
 * retrieval and would never surface as an error anywhere else.
 */
export async function recordIndexCoverage(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
}): Promise<number> {
  const { db } = container();

  const [units, chunks] = await Promise.all([
    db
      .select({ text: schema.documentUnits.text })
      .from(schema.documentUnits)
      .where(eq(schema.documentUnits.fileVersionId, input.fileVersionId))
      .orderBy(schema.documentUnits.ordinal),
    db
      .select({ text: schema.chunks.text, tokenEstimate: schema.chunks.tokenEstimate })
      .from(schema.chunks)
      .where(eq(schema.chunks.fileVersionId, input.fileVersionId))
      .orderBy(schema.chunks.ordinal),
  ]);

  if (units.length === 0) return 1;

  const coverage = measureCoverage({
    unitTexts: units.map((unit) => unit.text),
    chunkTexts: chunks.map((chunk) => chunk.text),
  });
  const statistics = chunkStatistics(chunks.map((chunk) => chunk.tokenEstimate));

  await db
    .update(schema.fileVersions)
    .set({ indexCoverage: coverage.coverage })
    .where(eq(schema.fileVersions.id, input.fileVersionId));

  await measure(
    'ingestion.index_coverage',
    {
      value: coverage.coverage,
      sampleSize: units.length,
      evidence: {
        fileName: input.fileName,
        eligibleCharacters: coverage.eligibleCharacters,
        coveredCharacters: coverage.coveredCharacters,
        chunkCount: statistics.count,
        meanChunkTokens: Math.round(statistics.mean),
        p95ChunkTokens: statistics.p95,
        // The actual missing runs, so a gap can be inspected rather than guessed at.
        gaps: coverage.gaps.slice(0, 5),
      },
    },
    {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileVersionId: input.fileVersionId,
    },
  );

  return coverage.coverage;
}

/** Every indexed passage must carry a usable vector, or it is unreachable semantically. */
export async function recordEmbeddingCompleteness(input: {
  fileVersionId: string;
  companionId: string;
  workspaceId: string;
  fileName: string;
}): Promise<number> {
  const { db } = container();

  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      embedded: sql<number>`count(*) FILTER (WHERE ${schema.chunks.embedding} IS NOT NULL)::int`,
    })
    .from(schema.chunks)
    .where(eq(schema.chunks.fileVersionId, input.fileVersionId));

  const total = rows[0]?.total ?? 0;
  if (total === 0) return 1;
  const embedded = rows[0]?.embedded ?? 0;
  const completeness = embedded / total;

  await measure(
    'ingestion.embedding_completeness',
    {
      value: completeness,
      sampleSize: total,
      evidence: {
        fileName: input.fileName,
        totalChunks: total,
        embeddedChunks: embedded,
        missingChunks: total - embedded,
        dimensions: EMBEDDING_DIMENSIONS,
      },
    },
    {
      workspaceId: input.workspaceId,
      companionId: input.companionId,
      fileVersionId: input.fileVersionId,
    },
  );

  return completeness;
}

/** Companion-wide ingestion success, for the operational dashboard. */
export async function recordIngestionSuccessRate(companionId: string): Promise<void> {
  const { db } = container();
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      ready: sql<number>`count(*) FILTER (WHERE ${schema.files.status} = 'READY')::int`,
    })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.companionId, companionId),
        eq(schema.files.isContainer, false),
        isNull(schema.files.removedAt),
      ),
    );

  const total = rows[0]?.total ?? 0;
  if (total === 0) return;

  const companion = await db
    .select({ workspaceId: schema.companions.workspaceId })
    .from(schema.companions)
    .where(eq(schema.companions.id, companionId))
    .limit(1);

  await measure(
    'ingestion.success_rate',
    {
      value: (rows[0]?.ready ?? 0) / total,
      sampleSize: total,
      evidence: { totalFiles: total, readyFiles: rows[0]?.ready ?? 0 },
    },
    { workspaceId: companion[0]?.workspaceId ?? null, companionId },
  );
}
