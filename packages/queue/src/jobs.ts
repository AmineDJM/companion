import type { JobType } from '@companion/shared';

/** Queue names. Kept small so the worker can be scaled per stage if needed. */
export const QUEUE_NAMES = {
  ingestion: 'companion.ingestion',
  indexing: 'companion.indexing',
  maintenance: 'companion.maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

interface BaseJob {
  /** Row id in `processing_jobs`; the durable record of this unit of work. */
  jobRecordId: string;
  workspaceId: string;
  companionId: string;
  /** Deterministic key; a retry with the same key must not duplicate work. */
  idempotencyKey: string;
}

export interface IngestUploadJob extends BaseJob {
  type: 'ingest_upload';
  fileId: string;
  fileVersionId: string;
}

export interface ExtractArchiveJob extends BaseJob {
  type: 'extract_archive';
  fileId: string;
  fileVersionId: string;
  /** Nesting level of this archive; guards against archive bombs. */
  depth: number;
}

export interface ConvertPreviewJob extends BaseJob {
  type: 'convert_preview';
  fileId: string;
  fileVersionId: string;
}

export interface ExtractTextJob extends BaseJob {
  type: 'extract_text';
  fileId: string;
  fileVersionId: string;
}

export interface OcrJob extends BaseJob {
  type: 'ocr';
  fileId: string;
  fileVersionId: string;
  pages?: number[];
}

export interface ChunkJob extends BaseJob {
  type: 'chunk';
  fileId: string;
  fileVersionId: string;
}

export interface EmbedJob extends BaseJob {
  type: 'embed';
  fileId: string;
  fileVersionId: string;
}

export interface ReindexFileJob extends BaseJob {
  type: 'reindex_file';
  fileId: string;
  fileVersionId: string;
  previousVersionId: string | null;
}

export interface FinalizeCompanionJob extends BaseJob {
  type: 'finalize_companion';
}

export interface ClusterQuestionsJob extends BaseJob {
  type: 'cluster_questions';
}

export interface PurgeCompanionJob extends BaseJob {
  type: 'purge_companion';
}

export type CompanionJob =
  | IngestUploadJob
  | ExtractArchiveJob
  | ConvertPreviewJob
  | ExtractTextJob
  | OcrJob
  | ChunkJob
  | EmbedJob
  | ReindexFileJob
  | FinalizeCompanionJob
  | ClusterQuestionsJob
  | PurgeCompanionJob;

export type JobOfType<T extends JobType> = Extract<CompanionJob, { type: T }>;

/** Which queue each job type is dispatched to. */
export const JOB_QUEUE: Record<JobType, QueueName> = {
  ingest_upload: QUEUE_NAMES.ingestion,
  extract_archive: QUEUE_NAMES.ingestion,
  convert_preview: QUEUE_NAMES.ingestion,
  extract_text: QUEUE_NAMES.ingestion,
  ocr: QUEUE_NAMES.ingestion,
  chunk: QUEUE_NAMES.indexing,
  embed: QUEUE_NAMES.indexing,
  reindex_file: QUEUE_NAMES.indexing,
  finalize_companion: QUEUE_NAMES.indexing,
  cluster_questions: QUEUE_NAMES.maintenance,
  purge_companion: QUEUE_NAMES.maintenance,
};

/** Retry policy per job type. OCR and conversion are slow but worth retrying. */
export const JOB_ATTEMPTS: Record<JobType, number> = {
  ingest_upload: 3,
  extract_archive: 2,
  convert_preview: 3,
  extract_text: 3,
  ocr: 2,
  chunk: 3,
  embed: 4,
  reindex_file: 3,
  finalize_companion: 5,
  cluster_questions: 2,
  purge_companion: 5,
};

/** Higher runs first. Paid plans get priority processing. */
export const PRIORITY = {
  high: 1,
  normal: 5,
  low: 10,
} as const;
