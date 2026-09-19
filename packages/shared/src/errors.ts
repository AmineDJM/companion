/** Machine-readable error codes shared between server and client. */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'quota_exceeded',
  'entitlement_required',
  'companion_expired',
  'companion_revoked',
  'companion_paused',
  'companion_not_ready',
  'password_required',
  'password_incorrect',
  'identity_required',
  'email_not_allowed',
  'download_disabled',
  'source_protected',
  'unsupported_file',
  'file_too_large',
  'archive_rejected',
  'provider_unavailable',
  'spend_cap_reached',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 402,
  entitlement_required: 402,
  companion_expired: 410,
  companion_revoked: 410,
  companion_paused: 423,
  companion_not_ready: 409,
  password_required: 401,
  password_incorrect: 401,
  identity_required: 401,
  email_not_allowed: 403,
  download_disabled: 403,
  source_protected: 403,
  unsupported_file: 415,
  file_too_large: 413,
  archive_rejected: 422,
  provider_unavailable: 503,
  spend_cap_reached: 429,
  internal_error: 500,
};

export interface AppErrorOptions {
  status?: number;
  /** Extra context safe to return to the caller. Never document content. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Recipient-facing copy. Deliberately plain and non-technical. */
export const RECIPIENT_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  companion_expired: 'This link has expired.',
  companion_revoked: 'This document is no longer available.',
  companion_paused: 'This document is temporarily unavailable.',
  not_found: 'This document is no longer available.',
  password_incorrect: 'Incorrect password.',
  password_required: 'This document is protected.',
  email_not_allowed: 'This document was not shared with that address.',
  download_disabled: 'Downloading is disabled for this document.',
  rate_limited: 'Too many questions in a short time. Please wait a moment.',
  quota_exceeded: 'Questions are temporarily unavailable for this document.',
};
