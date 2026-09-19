/**
 * Domain-wide enumerations and literal unions.
 * These are the single source of truth; the database schema mirrors them.
 */

export const COMPANION_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'REVOKED',
  'ARCHIVED',
  'FAILED',
] as const;
export type CompanionStatus = (typeof COMPANION_STATUSES)[number];

/** Statuses that consume a slot of the plan's active-Companion allowance. */
export const QUOTA_CONSUMING_STATUSES: readonly CompanionStatus[] = [
  'DRAFT',
  'PROCESSING',
  'ACTIVE',
  'PAUSED',
  'FAILED',
];

/** Statuses a recipient may ever be served content from. */
export const RECIPIENT_SERVABLE_STATUSES: readonly CompanionStatus[] = ['ACTIVE'];

export const ACCESS_MODES = ['PUBLIC', 'PASSWORD', 'EMAIL_LIST', 'IDENTIFIED'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const SOURCE_PROTECTION_MODES = ['OFF', 'STANDARD', 'STRICT'] as const;
export type SourceProtectionMode = (typeof SOURCE_PROTECTION_MODES)[number];

export const FILE_STATUSES = [
  'PENDING',
  'UPLOADING',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
  'UNSUPPORTED',
  'REMOVED',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const DOCUMENT_KINDS = [
  'PDF',
  'WORD',
  'SLIDES',
  'SPREADSHEET',
  'TEXT',
  'IMAGE',
  'ARCHIVE',
  'UNKNOWN',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const UNIT_KINDS = ['PAGE', 'SLIDE', 'SHEET', 'SECTION', 'IMAGE'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const JOB_TYPES = [
  'ingest_upload',
  'extract_archive',
  'convert_preview',
  'extract_text',
  'ocr',
  'chunk',
  'embed',
  'reindex_file',
  'finalize_companion',
  'cluster_questions',
  'purge_companion',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'SKIPPED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PLAN_KEYS = ['free', 'personal', 'pro', 'business'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const ANALYTICS_EVENT_TYPES = [
  'companion_opened',
  'file_opened',
  'page_viewed',
  'question_asked',
  'question_unanswered',
  'citation_opened',
  'download_clicked',
  'access_denied',
  'password_success',
  'password_failure',
  'identity_verified',
  'search_performed',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const USAGE_ADJUSTMENT_TYPES = [
  'ADMIN_BONUS',
  'ADMIN_DEDUCTION',
  'PURCHASE',
  'PROMOTIONAL',
  'MIGRATION',
  'REFUND',
] as const;
export type UsageAdjustmentType = (typeof USAGE_ADJUSTMENT_TYPES)[number];

export const AI_REQUEST_KINDS = [
  'answer',
  'embedding',
  'query_expansion',
  'topic_clustering',
  'ocr',
] as const;
export type AiRequestKind = (typeof AI_REQUEST_KINDS)[number];

export const ANALYTICS_LEVELS = ['basic', 'full', 'advanced'] as const;
export type AnalyticsLevel = (typeof ANALYTICS_LEVELS)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PLATFORM_ROLES = ['user', 'support', 'super_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const WORKSPACE_STATUSES = ['active', 'suspended'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];
