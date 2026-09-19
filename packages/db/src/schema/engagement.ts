import {
  boolean,
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
import type { AnalyticsEventType } from '@companion/shared';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';
import { chunks, companions, documentUnits, files } from './companions.js';
import { workspaces } from './identity.js';

/**
 * A recipient session is privacy-preserving by default: a random id in a
 * cookie, no account, no raw IP. Identity is attached only when the sender
 * required it and the recipient confirmed an email.
 */
export const recipientSessions = pgTable(
  'recipient_sessions',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** Proven the share password during this session. */
    passwordVerifiedAt: ts('password_verified_at'),
    verifiedEmail: varchar('verified_email', { length: 254 }),
    identityId: uuid('identity_id'),
    /** Salted hash only, for abuse throttling. The raw address is never stored. */
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgentFamily: varchar('user_agent_family', { length: 60 }),
    countryCode: varchar('country_code', { length: 2 }),
    questionCount: integer('question_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    /** Cumulative source-protection state for this session. */
    extractionAttempts: integer('extraction_attempts').notNull().default(0),
    quotedCharacters: integer('quoted_characters').notNull().default(0),
    quotedUnitIds: jsonb('quoted_unit_ids').$type<string[]>().notNull().default([]),
    answersDelivered: integer('answers_delivered').notNull().default(0),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('recipient_sessions_token_key').on(table.tokenHash),
    index('recipient_sessions_companion_idx').on(table.companionId, table.firstSeenAt),
    index('recipient_sessions_email_idx').on(table.verifiedEmail),
  ],
);

/** A confirmed recipient email, scoped to one Companion. Not a Companion account. */
export const recipientIdentities = pgTable(
  'recipient_identities',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 160 }),
    verifiedAt: ts('verified_at'),
    /** One-time code hash for passwordless confirmation. */
    codeHash: varchar('code_hash', { length: 64 }),
    codeExpiresAt: ts('code_expires_at'),
    codeAttempts: integer('code_attempts').notNull().default(0),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    visitCount: integer('visit_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('recipient_identities_unique').on(table.companionId, table.email),
    index('recipient_identities_email_idx').on(table.email),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    recipientSessionId: uuid('recipient_session_id')
      .notNull()
      .references(() => recipientSessions.id, { onDelete: 'cascade' }),
    /** Versions in play when the conversation began, to detect stale answers. */
    startedAgainstVersions: jsonb('started_against_versions').$type<Record<string, string>>(),
    questionCount: integer('question_count').notNull().default(0),
    lastMessageAt: ts('last_message_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('conversations_companion_idx').on(table.companionId),
    index('conversations_session_idx').on(table.recipientSessionId),
  ],
);

export const questions = pgTable(
  'questions',
  {
    id: primaryId(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recipientSessionId: uuid('recipient_session_id')
      .notNull()
      .references(() => recipientSessions.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** Viewer state at the moment of asking. */
    contextFileId: uuid('context_file_id').references(() => files.id, { onDelete: 'set null' }),
    contextPage: integer('context_page'),
    contextSheet: varchar('context_sheet', { length: 200 }),
    hasSelection: boolean('has_selection').notNull().default(false),
    /** Outcome of the source-protection classifier. */
    protectionIntent: varchar('protection_intent', { length: 32 }),
    protectionScore: real('protection_score'),
    blockedByProtection: boolean('blocked_by_protection').notNull().default(false),
    topicId: uuid('topic_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('questions_companion_idx').on(table.companionId, table.createdAt),
    index('questions_workspace_idx').on(table.workspaceId, table.createdAt),
    index('questions_session_idx').on(table.recipientSessionId),
    index('questions_topic_idx').on(table.topicId),
  ],
);

export const answers = pgTable(
  'answers',
  {
    id: primaryId(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** False when retrieval could not support an answer, or protection refused. */
    answered: boolean('answered').notNull().default(true),
    refusalKind: varchar('refusal_kind', { length: 32 })
      .$type<'none' | 'source_protection' | 'no_context' | 'rate_limited' | 'quota'>()
      .notNull()
      .default('none'),
    confidence: real('confidence'),
    model: varchar('model', { length: 64 }),
    latencyMs: integer('latency_ms'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('answers_question_key').on(table.questionId),
    index('answers_companion_idx').on(table.companionId),
  ],
);

export const citations = pgTable(
  'citations',
  {
    id: primaryId(),
    answerId: uuid('answer_id')
      .notNull()
      .references(() => answers.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id').notNull(),
    unitId: uuid('unit_id').references(() => documentUnits.id, { onDelete: 'set null' }),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'set null' }),
    page: integer('page'),
    slide: integer('slide'),
    sheetName: varchar('sheet_name', { length: 200 }),
    range: varchar('range', { length: 64 }),
    sectionTitle: varchar('section_title', { length: 500 }),
    quote: text('quote'),
    relevance: real('relevance').notNull().default(0),
    position: integer('position').notNull().default(0),
    openedCount: integer('opened_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('citations_answer_idx').on(table.answerId, table.position),
    index('citations_file_idx').on(table.fileId),
  ],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recipientSessionId: uuid('recipient_session_id').references(() => recipientSessions.id, {
      onDelete: 'cascade',
    }),
    type: varchar('type', { length: 40 }).$type<AnalyticsEventType>().notNull(),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    page: integer('page'),
    durationMs: integer('duration_ms'),
    /** Small, non-identifying context. Never document content. */
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean>>(),
    /**
     * Stable key for this occurrence. A retry, a page refresh or a replayed
     * request carrying the same key is stored once, so a customer's numbers
     * cannot be inflated by anything other than real activity.
     */
    /**
     * Per-occurrence key. Required: a row that cannot be deduplicated is a row
     * that cannot be reconciled, and the writer generates one when the caller
     * has no stable id.
     */
    idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
    occurredAt: ts('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('analytics_events_idempotency_key').on(table.idempotencyKey),
    index('analytics_events_companion_idx').on(table.companionId, table.occurredAt),
    index('analytics_events_workspace_idx').on(table.workspaceId, table.occurredAt),
    index('analytics_events_type_idx').on(table.type),
    index('analytics_events_file_idx').on(table.fileId),
  ],
);

/**
 * Question themes, clustered asynchronously and updated incrementally so no
 * model call happens on an analytics page load.
 */
export const questionTopics = pgTable(
  'question_topics',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 120 }).notNull(),
    /** Normalised key so incremental updates match an existing cluster. */
    slug: varchar('slug', { length: 120 }).notNull(),
    questionCount: integer('question_count').notNull().default(0),
    unansweredCount: integer('unanswered_count').notNull().default(0),
    exampleQuestions: jsonb('example_questions').$type<string[]>().notNull().default([]),
    confidence: real('confidence').notNull().default(0),
    /** Operator-facing note when the documents do not answer this theme well. */
    insight: text('insight'),
    centroid: jsonb('centroid').$type<number[]>(),
    lastQuestionAt: ts('last_question_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('question_topics_unique').on(table.companionId, table.slug),
    index('question_topics_count_idx').on(table.companionId, table.questionCount),
  ],
);
