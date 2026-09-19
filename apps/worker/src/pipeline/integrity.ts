import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, or, schema, sql } from '@companion/db';
import { container } from '../container.js';
import { chainJob } from '../lib/jobs.js';
import { measure, recordRepair } from '../lib/quality.js';
import { sha256 } from './fidelity.js';

/**
 * Storage integrity.
 *
 * A row in the database is a claim that an object exists. This sweep tests the
 * claim: every sampled key is HEADed for presence and size, a subset has its
 * bytes re-read and re-digested, and a probe object is written and read back to
 * prove the bucket is still durable. Nothing here trusts a previous successful
 * write as evidence of a current one.
 */

/** Objects HEADed per pass. Bounded so the sweep never competes with ingestion. */
const SHALLOW_SAMPLE = 200;
/** Objects fully re-read per pass. Deep verification costs bandwidth. */
const DEEP_SAMPLE = 20;
/** How long a verified object is trusted before it is checked again. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

interface Candidate {
  storageKey: string;
  workspaceId: string | null;
  fileVersionId: string | null;
  expectedSizeBytes: number;
  expectedHash: string | null;
}

export async function runStorageIntegritySweep(): Promise<void> {
  const { db, logger } = container();

  const cutoff = new Date(Date.now() - RECHECK_AFTER_MS);

  const versions = await db
    .select({
      storageKey: schema.fileVersions.storageKey,
      workspaceId: schema.companions.workspaceId,
      fileVersionId: schema.fileVersions.id,
      expectedSizeBytes: schema.fileVersions.sizeBytes,
      expectedHash: schema.fileVersions.contentHash,
    })
    .from(schema.fileVersions)
    .innerJoin(schema.companions, eq(schema.companions.id, schema.fileVersions.companionId))
    .where(
      and(
        isNull(schema.companions.deletedAt),
        or(
          isNull(schema.fileVersions.verifiedHashAt),
          lt(schema.fileVersions.verifiedHashAt, cutoff),
        ),
      ),
    )
    .orderBy(schema.fileVersions.verifiedHashAt)
    .limit(SHALLOW_SAMPLE);

  const artifacts = await db
    .select({
      storageKey: schema.previewArtifacts.storageKey,
      workspaceId: schema.companions.workspaceId,
      fileVersionId: schema.previewArtifacts.fileVersionId,
      expectedSizeBytes: schema.previewArtifacts.sizeBytes,
    })
    .from(schema.previewArtifacts)
    .innerJoin(schema.companions, eq(schema.companions.id, schema.previewArtifacts.companionId))
    .where(isNull(schema.companions.deletedAt))
    .orderBy(desc(schema.previewArtifacts.createdAt))
    .limit(SHALLOW_SAMPLE);

  const candidates: Candidate[] = [
    ...versions.map((row) => ({ ...row, expectedHash: row.expectedHash })),
    // Derived artifacts carry no upload digest; presence and size are the claim.
    ...artifacts.map((row) => ({ ...row, expectedHash: null })),
  ];

  if (candidates.length === 0) {
    await probeDurability();
    return;
  }

  let missing = 0;
  let sizeMismatches = 0;
  let hashMismatches = 0;
  let deepVerified = 0;
  const damaged: Candidate[] = [];

  for (const [index, candidate] of candidates.entries()) {
    // Deep verification is spread across the sample rather than front-loaded,
    // so one slow pass does not always re-read the same objects.
    const deep = candidate.expectedHash !== null && index % Math.ceil(candidates.length / DEEP_SAMPLE) === 0;
    const outcome = await inspect(candidate, deep);

    if (outcome.outcome === 'missing' || outcome.outcome === 'unreadable') missing += 1;
    if (outcome.outcome === 'size_mismatch') sizeMismatches += 1;
    if (outcome.outcome === 'hash_mismatch') hashMismatches += 1;
    if (outcome.deepVerified) deepVerified += 1;
    if (outcome.outcome !== 'ok') damaged.push(candidate);

    await db.insert(schema.storageIntegrityChecks).values({
      storageKey: candidate.storageKey,
      workspaceId: candidate.workspaceId,
      fileVersionId: candidate.fileVersionId,
      expectedSizeBytes: candidate.expectedSizeBytes,
      observedSizeBytes: outcome.observedSizeBytes,
      expectedHash: candidate.expectedHash,
      observedHash: outcome.observedHash,
      outcome: outcome.outcome,
      deepVerified: outcome.deepVerified,
      checkedAt: new Date(),
    });

    if (outcome.outcome === 'ok' && outcome.deepVerified && candidate.fileVersionId) {
      await db
        .update(schema.fileVersions)
        .set({ verifiedHashAt: new Date() })
        .where(eq(schema.fileVersions.id, candidate.fileVersionId));
    }
  }

  const evidence = {
    sampledObjects: candidates.length,
    deepVerifiedObjects: deepVerified,
    // Keys, never content: this record is read by operators, not auditors of the document.
    damagedKeys: damaged.slice(0, 10).map((row) => row.storageKey),
  };

  await measure('storage.missing_objects', { value: missing, sampleSize: candidates.length, evidence });
  await measure('storage.size_mismatches', {
    value: sizeMismatches,
    sampleSize: candidates.length,
    evidence,
  });
  await measure('storage.hash_mismatches', {
    value: hashMismatches,
    sampleSize: deepVerified,
    evidence,
  });

  if (damaged.length > 0) {
    logger.error('storage integrity sweep found damaged objects', {
      missing,
      sizeMismatches,
      hashMismatches,
    });
    await repair(damaged);
  }

  await measureOrphanRows();
  await probeDurability();
}

interface InspectionResult {
  outcome: 'ok' | 'missing' | 'size_mismatch' | 'hash_mismatch' | 'unreadable';
  observedSizeBytes: number | null;
  observedHash: string | null;
  deepVerified: boolean;
}

async function inspect(candidate: Candidate, deep: boolean): Promise<InspectionResult> {
  const { storage } = container();

  let head: { size: number } | null;
  try {
    head = await storage.head(candidate.storageKey);
  } catch {
    return { outcome: 'unreadable', observedSizeBytes: null, observedHash: null, deepVerified: false };
  }

  if (!head) {
    return { outcome: 'missing', observedSizeBytes: null, observedHash: null, deepVerified: false };
  }
  if (head.size !== candidate.expectedSizeBytes) {
    return {
      outcome: 'size_mismatch',
      observedSizeBytes: head.size,
      observedHash: null,
      deepVerified: false,
    };
  }
  if (!deep || !candidate.expectedHash) {
    return { outcome: 'ok', observedSizeBytes: head.size, observedHash: null, deepVerified: false };
  }

  let bytes: Buffer;
  try {
    bytes = await storage.get(candidate.storageKey);
  } catch {
    return {
      outcome: 'unreadable',
      observedSizeBytes: head.size,
      observedHash: null,
      deepVerified: false,
    };
  }

  const observedHash = sha256(bytes);
  return {
    outcome: observedHash === candidate.expectedHash ? 'ok' : 'hash_mismatch',
    observedSizeBytes: bytes.byteLength,
    observedHash,
    deepVerified: true,
  };
}

/**
 * Repair.
 *
 * Derived artifacts are regenerable, so a damaged preview is re-ingested from
 * the original. A damaged original is not recoverable from anything Companion
 * holds — the honest repair is to mark the file so the sender is told, rather
 * than to leave a link that silently serves nothing.
 */
async function repair(damaged: Candidate[]): Promise<void> {
  const { db, logger } = container();

  const fileVersionIds = [
    ...new Set(damaged.map((row) => row.fileVersionId).filter((id): id is string => id !== null)),
  ];
  if (fileVersionIds.length === 0) return;

  const versions = await db
    .select({
      id: schema.fileVersions.id,
      fileId: schema.fileVersions.fileId,
      companionId: schema.fileVersions.companionId,
      storageKey: schema.fileVersions.storageKey,
      workspaceId: schema.companions.workspaceId,
    })
    .from(schema.fileVersions)
    .innerJoin(schema.companions, eq(schema.companions.id, schema.fileVersions.companionId))
    .where(inArray(schema.fileVersions.id, fileVersionIds));

  const originalsDamaged = new Set(
    damaged
      .filter((row) => versions.some((version) => version.storageKey === row.storageKey))
      .map((row) => row.fileVersionId),
  );

  for (const version of versions) {
    if (originalsDamaged.has(version.id)) {
      await db
        .update(schema.files)
        .set({
          status: 'FAILED',
          statusMessage: 'The stored copy of this file is damaged. Please upload it again.',
          updatedAt: new Date(),
        })
        .where(eq(schema.files.id, version.fileId));
      await recordRepair({
        metricId: 'storage.hash_mismatches',
        fileVersionId: version.id,
        outcome: 'unrepairable',
      });
      logger.error('original object is damaged; file marked for re-upload', {
        fileVersionId: version.id,
      });
      continue;
    }

    // Only derived artifacts are missing: rebuilding them is deterministic.
    await chainJob('reindex_file', {
      workspaceId: version.workspaceId,
      companionId: version.companionId,
      fileId: version.fileId,
      fileVersionId: version.id,
      // A repair must be able to run again after a later sweep finds the same
      // object missing, so it is keyed by the sweep rather than by the file.
      trigger: `repair-${new Date().toISOString().slice(0, 13)}`,
    });
    await recordRepair({
      metricId: 'storage.missing_objects',
      fileVersionId: version.id,
      outcome: 'repaired',
    });
  }
}

/** Database rows that claim an object no longer referenced by any live file. */
async function measureOrphanRows(): Promise<void> {
  const { db } = container();
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.previewArtifacts)
    .leftJoin(
      schema.fileVersions,
      eq(schema.fileVersions.id, schema.previewArtifacts.fileVersionId),
    )
    .where(isNull(schema.fileVersions.id));

  await measure('storage.orphan_database_rows', {
    value: rows[0]?.value ?? 0,
    evidence: { table: 'preview_artifacts' },
  });
}

/**
 * Durability probe.
 *
 * Writes a unique object, reads it back and compares digests. This is what
 * distinguishes a configured bucket from a working one, and it is the check
 * that fails loudly if canonical storage were ever pointed at a container's
 * ephemeral local disk.
 */
async function probeDurability(): Promise<void> {
  const { storage } = container();
  const key = `_integrity/probe-${randomUUID()}.bin`;
  const body = Buffer.from(randomUUID().repeat(4), 'utf8');
  const expected = sha256(body);

  let value = 0;
  let detail = 'probe failed to write';

  try {
    await storage.put({ key, body, contentType: 'application/octet-stream' });
    const readBack = await storage.get(key);
    value = sha256(readBack) === expected ? 1 : 0;
    detail = value === 1 ? 'round trip verified' : 'round trip returned different bytes';
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 200) : 'unknown storage error';
  } finally {
    await storage.delete(key).catch(() => undefined);
  }

  await measure('storage.durability_roundtrip', {
    value,
    sampleSize: 1,
    evidence: { driver: storage.name, detail, sizeBytes: body.byteLength },
  });
}
