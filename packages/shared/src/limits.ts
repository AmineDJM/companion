import { z } from 'zod';

/**
 * Platform safety limits. These are *technical abuse caps*, deliberately
 * independent from commercial plan entitlements: a Business customer still
 * cannot upload a 40-level-deep nested ZIP.
 *
 * Values are seeded into the `platform_limits` table and may be edited by a
 * Super Admin at runtime; this object is the fallback and the schema.
 */
export const platformLimitsSchema = z.object({
  /** Hard ceiling for a single file, whatever the plan says. */
  maxFileBytes: z.number().int().positive(),
  /** Hard ceiling for one upload batch. */
  maxBatchBytes: z.number().int().positive(),
  /** Hard ceiling for the total uncompressed size of one archive. */
  maxArchiveExtractedBytes: z.number().int().positive(),
  /** Reject an archive whose uncompressed:compressed ratio exceeds this (zip bomb). */
  maxCompressionRatio: z.number().positive(),
  /** Entries allowed inside a single archive. */
  maxArchiveEntries: z.number().int().positive(),
  /** How deep nested archives may go (1 = no nesting). */
  maxArchiveDepth: z.number().int().positive(),
  /** Hard ceiling on files in one Companion. */
  maxFilesPerCompanion: z.number().int().positive(),
  /** Pages/slides/sheets indexed per document. */
  maxUnitsPerFile: z.number().int().positive(),
  /** Recipient questions per minute for one recipient session. */
  maxQuestionsPerMinutePerSession: z.number().int().positive(),
  /** Recipient questions per minute across one workspace. */
  maxQuestionsPerMinutePerWorkspace: z.number().int().positive(),
  /** Questions one anonymous session may ask in total before being throttled. */
  maxQuestionsPerSession: z.number().int().positive(),
  /** Concurrent anonymous sessions tracked per Companion. */
  maxSessionsPerCompanionPerHour: z.number().int().positive(),
  /** Login attempts per identifier per 15 minutes. */
  maxAuthAttemptsPerWindow: z.number().int().positive(),
  /** Password attempts on a protected Companion per 15 minutes. */
  maxPasswordAttemptsPerWindow: z.number().int().positive(),
  /** Absolute ceiling on tokens sent to the answer model in one request. */
  maxAnswerInputTokens: z.number().int().positive(),
  /** Absolute ceiling on generated tokens. */
  maxAnswerOutputTokens: z.number().int().positive(),
  /** Retrieved chunks allowed in one answer request. */
  maxRetrievalChunks: z.number().int().positive(),
  /** Safety threshold: alert when one workspace exceeds this AI spend in a month. */
  workspaceMonthlySpendAlertUsd: z.number().positive(),
  /** Emergency stop: refuse AI calls for a workspace beyond this monthly spend. */
  workspaceMonthlySpendHardCapUsd: z.number().positive(),
});

export type PlatformLimits = z.infer<typeof platformLimitsSchema>;

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const DEFAULT_PLATFORM_LIMITS: PlatformLimits = {
  maxFileBytes: 2 * GB,
  maxBatchBytes: 4 * GB,
  maxArchiveExtractedBytes: 5 * GB,
  maxCompressionRatio: 120,
  maxArchiveEntries: 5_000,
  maxArchiveDepth: 4,
  maxFilesPerCompanion: 2_000,
  maxUnitsPerFile: 5_000,
  maxQuestionsPerMinutePerSession: 8,
  maxQuestionsPerMinutePerWorkspace: 120,
  maxQuestionsPerSession: 150,
  maxSessionsPerCompanionPerHour: 500,
  maxAuthAttemptsPerWindow: 10,
  maxPasswordAttemptsPerWindow: 10,
  maxAnswerInputTokens: 60_000,
  maxAnswerOutputTokens: 1_200,
  maxRetrievalChunks: 24,
  workspaceMonthlySpendAlertUsd: 50,
  workspaceMonthlySpendHardCapUsd: 400,
};

/** Retrieval budget targets. Exceeded only for genuinely complex questions. */
export const RETRIEVAL_BUDGET = {
  defaultChunks: 6,
  minChunks: 4,
  maxChunksNormal: 8,
  maxChunksComplex: 14,
  targetContextTokens: 3_500,
  maxContextTokensNormal: 10_000,
  maxContextTokensComplex: 16_000,
  activeContextTokens: 700,
  defaultMaxOutputTokens: 700,
  complexMaxOutputTokens: 1_100,
} as const;

export const ACCEPTED_EXTENSIONS = [
  // Everything LibreOffice and Poppler between them can render, plus the
  // formats read directly. Legacy binary and modern XML alike: a 2003 .ppt
  // and a 2024 .pptx are both just a deck to the person you sent it to.
  'pdf',
  // Word processing
  'doc', 'dot', 'docx', 'docm', 'dotx', 'odt', 'ott', 'rtf', 'epub',
  // Presentations
  'ppt', 'pps', 'pptx', 'pptm', 'ppsx', 'potx', 'odp', 'otp', 'odg',
  // Spreadsheets
  'xls', 'xlt', 'xlsx', 'xlsm', 'xltx', 'ods', 'ots', 'csv', 'tsv',
  // Text
  'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'log',
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg',
  // Archives
  'zip',
] as const;

export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** File extensions that are refused inside archives regardless of anything else. */
export const ARCHIVE_DENYLIST_EXTENSIONS = [
  'exe',
  'dll',
  'so',
  'dylib',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'app',
  'sh',
  'bash',
  'ps1',
  'vbs',
  'js',
  'jar',
  'apk',
  'deb',
  'rpm',
  'pkg',
  'bin',
  'elf',
] as const;
