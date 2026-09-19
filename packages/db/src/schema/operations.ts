import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AiRequestKind, PlanKey, PlatformLimits } from '@companion/shared';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';
import { companions } from './companions.js';
import { users, workspaces } from './identity.js';

/**
 * Every model call is recorded here with its *actual* reported token usage and
 * the cost computed from the centralised pricing table. This is the source of
 * truth for unit economics in /admin.
 */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id').references(() => companions.id, { onDelete: 'set null' }),
    recipientSessionId: uuid('recipient_session_id'),
    questionId: uuid('question_id'),
    provider: varchar('provider', { length: 40 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    requestKind: varchar('request_kind', { length: 32 }).$type<AiRequestKind>().notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    /** False for provider errors — these never consume the customer's quota. */
    succeeded: boolean('succeeded').notNull().default(true),
    /** True when this call consumed one unit of the question allowance. */
    billable: boolean('billable').notNull().default(false),
    errorCode: varchar('error_code', { length: 64 }),
    requestId: varchar('request_id', { length: 120 }),
    occurredAt: ts('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('usage_ledger_workspace_idx').on(table.workspaceId, table.occurredAt),
    index('usage_ledger_companion_idx').on(table.companionId, table.occurredAt),
    index('usage_ledger_kind_idx').on(table.requestKind, table.occurredAt),
    index('usage_ledger_model_idx').on(table.model),
    index('usage_ledger_billable_idx').on(table.workspaceId, table.billable, table.occurredAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'user' | 'admin' | 'system' | 'stripe' — who initiated the change. */
    actorType: varchar('actor_type', { length: 20 }).notNull().default('user'),
    actorLabel: varchar('actor_label', { length: 254 }),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 64 }),
    targetLabel: varchar('target_label', { length: 300 }),
    /** Structured context. Document contents are never written here. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_workspace_idx').on(table.workspaceId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId, table.createdAt),
    index('audit_logs_action_idx').on(table.action, table.createdAt),
    index('audit_logs_target_idx').on(table.targetType, table.targetId),
  ],
);

/** Private operator notes about a customer. Never surfaced to the customer. */
export const adminNotes = pgTable(
  'admin_notes',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorLabel: varchar('author_label', { length: 254 }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('admin_notes_workspace_idx').on(table.workspaceId, table.createdAt)],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: primaryId(),
    key: varchar('key', { length: 64 }).notNull(),
    description: varchar('description', { length: 500 }),
    enabledGlobally: boolean('enabled_globally').notNull().default(false),
    enabledPlans: jsonb('enabled_plans').$type<PlanKey[]>().notNull().default([]),
    enabledWorkspaceIds: jsonb('enabled_workspace_ids').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('feature_flags_key_key').on(table.key)],
);

/** Single-row configuration table for platform-wide technical caps. */
export const platformSettings = pgTable('platform_settings', {
  id: varchar('id', { length: 16 }).primaryKey().default('singleton'),
  limits: jsonb('limits').$type<PlatformLimits>().notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const providerHealth = pgTable(
  'provider_health',
  {
    id: primaryId(),
    provider: varchar('provider', { length: 40 }).notNull(),
    /** 'answer' | 'embedding' | 'storage' | 'stripe' — which capability was probed. */
    capability: varchar('capability', { length: 40 }).notNull(),
    healthy: boolean('healthy').notNull(),
    latencyMs: integer('latency_ms'),
    /** Sanitised message only; never a raw provider payload. */
    message: varchar('message', { length: 300 }),
    checkedAt: ts('checked_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('provider_health_provider_idx').on(table.provider, table.checkedAt),
    index('provider_health_checked_idx').on(table.checkedAt),
  ],
);

/** Worker liveness, so /admin/system can tell whether processing is alive. */
export const workerHeartbeats = pgTable(
  'worker_heartbeats',
  {
    id: varchar('id', { length: 120 }).primaryKey(),
    hostname: varchar('hostname', { length: 200 }),
    version: varchar('version', { length: 40 }),
    queues: jsonb('queues').$type<string[]>().notNull().default([]),
    activeJobs: integer('active_jobs').notNull().default(0),
    completedJobs: bigint('completed_jobs', { mode: 'number' }).notNull().default(0),
    failedJobs: bigint('failed_jobs', { mode: 'number' }).notNull().default(0),
    startedAt: ts('started_at').notNull(),
    lastBeatAt: ts('last_beat_at').notNull(),
  },
  (table) => [index('worker_heartbeats_beat_idx').on(table.lastBeatAt)],
);

/** Scheduled deletion of storage objects, so nothing is orphaned. */
export const storageReclamations = pgTable(
  'storage_reclamations',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    storageKey: varchar('storage_key', { length: 600 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    reason: varchar('reason', { length: 80 }).notNull(),
    deleteAfterAt: ts('delete_after_at').notNull(),
    deletedAt: ts('deleted_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [
    index('storage_reclamations_pending_idx').on(table.deletedAt, table.deleteAfterAt),
    uniqueIndex('storage_reclamations_key_key').on(table.storageKey),
  ],
);

/** Daily rollup so /admin dashboards stay fast as the ledger grows. */
export const usageDailyRollups = pgTable(
  'usage_daily_rollups',
  {
    id: primaryId(),
    day: varchar('day', { length: 10 }).notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    questions: integer('questions').notNull().default(0),
    answers: integer('answers').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    cachedInputTokens: bigint('cached_input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    answerCostUsd: doublePrecision('answer_cost_usd').notNull().default(0),
    embeddingCostUsd: doublePrecision('embedding_cost_usd').notNull().default(0),
    totalCostUsd: doublePrecision('total_cost_usd').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('usage_daily_rollups_unique').on(table.day, table.workspaceId),
    index('usage_daily_rollups_day_idx').on(table.day),
  ],
);
