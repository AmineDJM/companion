import { sql } from 'drizzle-orm';
import {
  bigint,
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
  vector,
} from 'drizzle-orm/pg-core';
import type {
  AccessMode,
  Branding,
  CompanionStatus,
  DocumentKind,
  FileStatus,
  JobStatus,
  JobType,
  SourceProtectionMode,
  UnitKind,
} from '@companion/shared';
import { EMBEDDING_DIMENSIONS } from '@companion/shared';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';
import { users, workspaces } from './identity.js';

export const companions = pgTable(
  'companions',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 160 }).notNull(),
    /** Short, non-sequential public identifier. Stable for the Companion's life. */
    slug: varchar('slug', { length: 24 }).notNull(),
    status: varchar('status', { length: 20 })
      .$type<CompanionStatus>()
      .notNull()
      .default('DRAFT'),
    defaultFileId: uuid('default_file_id'),
    downloadAllowed: boolean('download_allowed').notNull().default(false),
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    sourceProtectionMode: varchar('source_protection_mode', { length: 16 })
      .$type<SourceProtectionMode>()
      .notNull()
      .default('STANDARD'),
    accessMode: varchar('access_mode', { length: 20 })
      .$type<AccessMode>()
      .notNull()
      .default('PUBLIC'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    pausedAt: ts('paused_at'),
    archivedAt: ts('archived_at'),
    publishedAt: ts('published_at'),
    branding: jsonb('branding').$type<Branding>(),
    /** Denormalised engagement counters, updated transactionally with events. */
    viewCount: integer('view_count').notNull().default(0),
    visitorCount: integer('visitor_count').notNull().default(0),
    questionCount: integer('question_count').notNull().default(0),
    unansweredCount: integer('unanswered_count').notNull().default(0),
    fileCount: integer('file_count').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    indexedUnits: integer('indexed_units').notNull().default(0),
    indexedChunks: integer('indexed_chunks').notNull().default(0),
    /** Processing progress 0..100 for the build screen. */
    processingProgress: integer('processing_progress').notNull().default(0),
    processingStep: varchar('processing_step', { length: 32 }),
    processingError: text('processing_error'),
    lastOpenedAt: ts('last_opened_at'),
    deletedAt: ts('deleted_at'),
    purgeAfterAt: ts('purge_after_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('companions_slug_key').on(table.slug),
    index('companions_workspace_idx').on(table.workspaceId, table.updatedAt),
    index('companions_status_idx').on(table.status),
    index('companions_expires_idx').on(table.expiresAt),
    index('companions_name_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.name})`,
    ),
  ],
);

export const companionAccessPolicies = pgTable(
  'companion_access_policies',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    /** scrypt hash of the share password. Never the password itself. */
    passwordHash: text('password_hash'),
    allowedEmails: jsonb('allowed_emails').$type<string[]>().notNull().default([]),
    allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
    /** Recipients must confirm an email even on otherwise public links. */
    requireIdentity: boolean('require_identity').notNull().default(false),
    /** Notify the sender the first time each recipient opens the link. */
    notifyOnOpen: boolean('notify_on_open').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('companion_access_policies_companion_key').on(table.companionId)],
);

export const companionDomains = pgTable(
  'companion_domains',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id').references(() => companions.id, { onDelete: 'cascade' }),
    hostname: varchar('hostname', { length: 253 }).notNull(),
    /** Optional path prefix so docs.customer.com/proposal can resolve. */
    pathPrefix: varchar('path_prefix', { length: 120 }),
    verificationToken: varchar('verification_token', { length: 64 }).notNull(),
    verifiedAt: ts('verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('companion_domains_hostname_key').on(table.hostname, table.pathPrefix),
    index('companion_domains_workspace_idx').on(table.workspaceId),
  ],
);

export const folders = pgTable(
  'folders',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 400 }).notNull(),
    /** Materialised path ("Security/Policies") for cheap tree rendering. */
    path: varchar('path', { length: 2000 }).notNull(),
    depth: integer('depth').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('folders_companion_path_key').on(table.companionId, table.path),
    index('folders_parent_idx').on(table.parentId),
  ],
);

export const files = pgTable(
  'files',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    /** Set when this file came out of an uploaded archive. */
    sourceArchiveFileId: uuid('source_archive_file_id'),
    name: varchar('name', { length: 400 }).notNull(),
    path: varchar('path', { length: 2000 }).notNull(),
    kind: varchar('kind', { length: 20 }).$type<DocumentKind>().notNull().default('UNKNOWN'),
    extension: varchar('extension', { length: 16 }).notNull().default(''),
    mimeType: varchar('mime_type', { length: 160 }).notNull().default('application/octet-stream'),
    status: varchar('status', { length: 20 }).$type<FileStatus>().notNull().default('PENDING'),
    statusMessage: varchar('status_message', { length: 500 }),
    /** Points at the version currently served and searched. */
    currentVersionId: uuid('current_version_id'),
    versionCount: integer('version_count').notNull().default(0),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    pageCount: integer('page_count'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Archives are containers: they are listed but never rendered or indexed. */
    isContainer: boolean('is_container').notNull().default(false),
    removedAt: ts('removed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('files_companion_idx').on(table.companionId, table.sortOrder),
    index('files_status_idx').on(table.status),
    index('files_folder_idx').on(table.folderId),
  ],
);

export const fileVersions = pgTable(
  'file_versions',
  {
    id: primaryId(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Private object-storage key. Never served directly to a browser. */
    storageKey: varchar('storage_key', { length: 600 }).notNull(),
    /** SHA-256 of the bytes; used for dedup and to skip re-embedding. */
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    originalFilename: varchar('original_filename', { length: 400 }).notNull(),
    pageCount: integer('page_count'),
    /** True once text extraction, chunking and embedding all succeeded. */
    indexedAt: ts('indexed_at'),
    /** True when a page had to be read from its rendered image. */
    usedVision: boolean('used_vision').notNull().default(false),
    textCharacters: integer('text_characters').notNull().default(0),
    /** SHA-256 recorded at upload; re-verified whenever the object is read. */
    verifiedHashAt: ts('verified_hash_at'),
    /** Structural units the source container itself declares. */
    declaredUnits: integer('declared_units'),
    /** Units the parser actually produced. */
    parsedUnits: integer('parsed_units'),
    /** Rendered preview pages, for the parity check. */
    previewUnits: integer('preview_units'),
    /** Pages whose recovered text scored below the legibility threshold. */
    lowConfidenceUnits: jsonb('low_confidence_units').$type<number[]>().notNull().default([]),
    /** Share of extracted text reachable through at least one indexed passage. */
    indexCoverage: real('index_coverage'),
    /** Version of the processing pipeline that produced this version's index. */
    processingVersion: varchar('processing_version', { length: 32 }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    supersededAt: ts('superseded_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('file_versions_file_version_key').on(table.fileId, table.version),
    index('file_versions_companion_idx').on(table.companionId),
    index('file_versions_hash_idx').on(table.contentHash),
  ],
);

export const previewArtifacts = pgTable(
  'preview_artifacts',
  {
    id: primaryId(),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 })
      .$type<'normalized_pdf' | 'page_image' | 'thumbnail' | 'sheet_html' | 'text'>()
      .notNull(),
    /** 1-based page/slide index for page images; null for whole-file artifacts. */
    page: integer('page'),
    storageKey: varchar('storage_key', { length: 600 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('preview_artifacts_unique').on(table.fileVersionId, table.kind, table.page),
    index('preview_artifacts_companion_idx').on(table.companionId),
  ],
);

/**
 * A document unit is one addressable location: a PDF page, a slide, a sheet, or
 * a heading-bounded section of a long text document. Citations resolve to these.
 */
export const documentUnits = pgTable(
  'document_units',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<UnitKind>().notNull(),
    /** 1-based ordinal within the document. */
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    slide: integer('slide'),
    sheetName: varchar('sheet_name', { length: 200 }),
    sectionTitle: varchar('section_title', { length: 500 }),
    /** Spreadsheet region such as "B12:F20". */
    range: varchar('range', { length: 64 }),
    text: text('text').notNull().default(''),
    characterCount: integer('character_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('document_units_version_ordinal_key').on(table.fileVersionId, table.ordinal),
    index('document_units_file_idx').on(table.fileId),
    index('document_units_companion_idx').on(table.companionId),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: primaryId(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => documentUnits.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    /** Denormalised citation metadata so retrieval needs no joins. */
    fileName: varchar('file_name', { length: 400 }).notNull(),
    kind: varchar('kind', { length: 20 }).$type<DocumentKind>().notNull(),
    page: integer('page'),
    slide: integer('slide'),
    sheetName: varchar('sheet_name', { length: 200 }),
    sectionTitle: varchar('section_title', { length: 500 }),
    range: varchar('range', { length: 64 }),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: varchar('embedding_model', { length: 64 }),
    /** Hash of the chunk text; unchanged text is never re-embedded. */
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('chunks_version_ordinal_key').on(table.fileVersionId, table.ordinal),
    index('chunks_companion_idx').on(table.companionId),
    index('chunks_file_version_idx').on(table.fileVersionId),
    index('chunks_hash_idx').on(table.contentHash),
    // Lexical half of hybrid retrieval.
    index('chunks_fts_idx').using('gin', sql`to_tsvector('english', ${table.text})`),
    // Semantic half. HNSW keeps recall high without an expensive rebuild.
    index('chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
);

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: primaryId(),
    companionId: uuid('companion_id').references(() => companions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'cascade' }),
    fileVersionId: uuid('file_version_id').references(() => fileVersions.id, {
      onDelete: 'cascade',
    }),
    type: varchar('type', { length: 40 }).$type<JobType>().notNull(),
    status: varchar('status', { length: 20 }).$type<JobStatus>().notNull().default('QUEUED'),
    /** Stable key so a retried job never duplicates chunks or embeddings. */
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    queueJobId: varchar('queue_job_id', { length: 120 }),
    priority: integer('priority').notNull().default(0),
    progress: integer('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    error: text('error'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('processing_jobs_idempotency_key').on(table.idempotencyKey),
    index('processing_jobs_companion_idx').on(table.companionId),
    index('processing_jobs_status_idx').on(table.status, table.createdAt),
    index('processing_jobs_type_idx').on(table.type),
  ],
);

/**
 * Upload drafts let a visitor drop files on the homepage before creating an
 * account. The draft holds the uploaded objects; signing up claims it, so the
 * files are never uploaded twice.
 */
export const uploadDrafts = pgTable(
  'upload_drafts',
  {
    id: primaryId(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }),
    /** Uploaded object descriptors awaiting a workspace. */
    items: jsonb('items')
      .$type<{ filename: string; storageKey: string; sizeBytes: number; contentType: string }[]>()
      .notNull()
      .default([]),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
    claimedByWorkspaceId: uuid('claimed_by_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    claimedCompanionId: uuid('claimed_companion_id').references(() => companions.id, {
      onDelete: 'set null',
    }),
    claimedAt: ts('claimed_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('upload_drafts_token_key').on(table.tokenHash),
    index('upload_drafts_expires_idx').on(table.expiresAt),
  ],
);

/** Relevance score recorded per retrieval, used for the "unanswered" report. */
export const retrievalDiagnostics = pgTable(
  'retrieval_diagnostics',
  {
    id: primaryId(),
    questionId: uuid('question_id').notNull(),
    companionId: uuid('companion_id')
      .notNull()
      .references(() => companions.id, { onDelete: 'cascade' }),
    topScore: real('top_score').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
    contextTokens: integer('context_tokens').notNull().default(0),
    fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
    complex: boolean('complex').notNull().default(false),
    /** Time spent searching, separate from the model's own latency. */
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('retrieval_diagnostics_companion_idx').on(table.companionId),
    index('retrieval_diagnostics_created_idx').on(table.createdAt),
  ],
);
