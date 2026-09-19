import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';
import { companions, fileVersions } from './companions.js';
import { users, workspaces } from './identity.js';

/**
 * Machine-readable quality evidence.
 *
 * Every measurement the system takes is stored with the value, the thresholds
 * it was judged against, the version of the specification in force, and the
 * inputs that produced it. The purpose is to be able to answer "why did this
 * pass?" months later without rerunning anything.
 */
export const qualityEvaluations = pgTable(
  'quality_evaluations',
  {
    id: primaryId(),
    /** Identifier from the quality specification, e.g. `ingestion.hash_match`. */
    metricId: varchar('metric_id', { length: 80 }).notNull(),
    /** Version of the specification this was judged against. */
    qualitySpecVersion: varchar('quality_spec_version', { length: 16 }).notNull(),
    value: doublePrecision('value').notNull(),
    status: varchar('status', { length: 8 }).$type<'pass' | 'warn' | 'fail'>().notNull(),
    severity: varchar('severity', { length: 16 })
      .$type<'CRITICAL' | 'HARD_FAIL' | 'WARNING' | 'INFO'>()
      .notNull(),
    sampleSize: integer('sample_size').notNull().default(1),
    /** The inputs that produced the value. Never document content. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    /** What the system should attempt when this fails. */
    repairStrategy: varchar('repair_strategy', { length: 40 }).notNull().default('none'),
    repairAttemptedAt: ts('repair_attempted_at'),
    repairOutcome: varchar('repair_outcome', { length: 24 })
      .$type<'pending' | 'repaired' | 'unrepairable' | 'not_applicable'>(),
    /** Value after the repair, when one was attempted. */
    valueAfterRepair: doublePrecision('value_after_repair'),

    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id').references(() => companions.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id').references(() => fileVersions.id, {
      onDelete: 'cascade',
    }),
    /** Release identifier, so a regression can be attributed to a deploy. */
    releaseId: varchar('release_id', { length: 64 }),
    /** Where the measurement ran: `worker`, `ci`, `api` or `probe`. */
    source: varchar('source', { length: 16 }).notNull().default('worker'),
    measuredAt: ts('measured_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('quality_evaluations_metric_idx').on(table.metricId, table.measuredAt),
    index('quality_evaluations_status_idx').on(table.status, table.measuredAt),
    index('quality_evaluations_companion_idx').on(table.companionId),
    index('quality_evaluations_release_idx').on(table.releaseId, table.metricId),
    index('quality_evaluations_workspace_idx').on(table.workspaceId, table.measuredAt),
  ],
);

/**
 * The golden evaluation corpus.
 *
 * A permanent, versioned set of questions with known answers and known
 * evidence. Retrieval and answer quality are judged against this, not against
 * whether a sample answer reads plausibly.
 */
export const goldenQuestions = pgTable(
  'golden_questions',
  {
    id: primaryId(),
    /** Stable key so results stay comparable across runs. */
    key: varchar('key', { length: 80 }).notNull(),
    companionId: uuid('companion_id').references(() => companions.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** Category for per-slice reporting: pdf, table, cross_document, ocr… */
    category: varchar('category', { length: 40 }).notNull(),
    answerable: jsonb('answerable').$type<boolean>().notNull(),
    /** File and unit where the answer genuinely lives. */
    expectedEvidence: jsonb('expected_evidence')
      .$type<{ fileName: string; page?: number; sheet?: string; quote?: string }[]>()
      .notNull()
      .default([]),
    /** Exact value the answer must contain, for deterministic checking. */
    expectedValue: varchar('expected_value', { length: 200 }),
    /** Substrings that must not appear, e.g. a figure from the wrong document. */
    forbiddenValues: jsonb('forbidden_values').$type<string[]>().notNull().default([]),
    /** Marks an adversarial case: injection, extraction, cross-tenant. */
    attackKind: varchar('attack_kind', { length: 40 }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('golden_questions_key_key').on(table.key),
    index('golden_questions_category_idx').on(table.category),
  ],
);

/** One golden-corpus run, so releases can be compared to each other. */
export const qualityRuns = pgTable(
  'quality_runs',
  {
    id: primaryId(),
    releaseId: varchar('release_id', { length: 64 }).notNull(),
    qualitySpecVersion: varchar('quality_spec_version', { length: 16 }).notNull(),
    kind: varchar('kind', { length: 32 })
      .$type<'golden_corpus' | 'security_matrix' | 'integrity_sweep' | 'full'>()
      .notNull(),
    passed: jsonb('passed').$type<boolean>().notNull(),
    blockingFailures: integer('blocking_failures').notNull().default(0),
    warnings: integer('warnings').notNull().default(0),
    /** Headline metrics, for the trend chart. */
    headline: jsonb('headline').$type<Record<string, number>>().notNull().default({}),
    summary: text('summary'),
    durationMs: integer('duration_ms'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index('quality_runs_release_idx').on(table.releaseId),
    index('quality_runs_kind_idx').on(table.kind, table.startedAt),
  ],
);

/**
 * Durable storage integrity records.
 *
 * Verified periodically rather than assumed: a successful upload response is
 * not evidence that the bytes are still there and still correct.
 */
export const storageIntegrityChecks = pgTable(
  'storage_integrity_checks',
  {
    id: primaryId(),
    storageKey: varchar('storage_key', { length: 600 }).notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id').references(() => fileVersions.id, {
      onDelete: 'cascade',
    }),
    expectedSizeBytes: integer('expected_size_bytes').notNull(),
    observedSizeBytes: integer('observed_size_bytes'),
    expectedHash: varchar('expected_hash', { length: 64 }),
    observedHash: varchar('observed_hash', { length: 64 }),
    outcome: varchar('outcome', { length: 24 })
      .$type<'ok' | 'missing' | 'size_mismatch' | 'hash_mismatch' | 'unreadable'>()
      .notNull(),
    /** True when the object's bytes were re-read rather than just HEADed. */
    deepVerified: jsonb('deep_verified').$type<boolean>().notNull().default(false),
    checkedAt: ts('checked_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('storage_integrity_key_idx').on(table.storageKey, table.checkedAt),
    index('storage_integrity_outcome_idx').on(table.outcome, table.checkedAt),
  ],
);

/**
 * Real-user performance samples from the recipient viewer.
 *
 * Collected in the browser with the standard Web Vitals entry types, so the
 * figures are comparable to published thresholds rather than to a synthetic
 * benchmark.
 */
export const viewerVitals = pgTable(
  'viewer_vitals',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** lcp, inp, cls, ttfb or first_page. */
    metric: varchar('metric', { length: 16 }).notNull(),
    value: real('value').notNull(),
    /** Device class, for slicing. Never a fingerprint. */
    deviceClass: varchar('device_class', { length: 16 }),
    occurredAt: ts('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('viewer_vitals_metric_idx').on(table.metric, table.occurredAt),
    index('viewer_vitals_companion_idx').on(table.companionId),
  ],
);
