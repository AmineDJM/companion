import type { AccessMode, CompanionStatus } from './constants.js';
import { AppError, type ErrorCode } from './errors.js';

/**
 * The recipient access decision is a pure function of Companion state plus the
 * credentials the current recipient session has already proven. It is evaluated
 * on *every* protected operation — page load, preview fetch, question, download
 * and citation navigation — never once at open time.
 */
export interface CompanionAccessState {
  status: CompanionStatus;
  accessMode: AccessMode;
  expiresAt: Date | null;
  revokedAt: Date | null;
  pausedAt: Date | null;
  downloadAllowed: boolean;
  aiEnabled: boolean;
  /** Set when the workspace has been suspended by an operator. */
  workspaceSuspended: boolean;
  allowedEmails: string[];
  allowedDomains: string[];
}

export interface RecipientCredentials {
  /** Recipient proved the shared password during this session. */
  passwordVerified: boolean;
  /** Verified email address, when identity was established. */
  verifiedEmail: string | null;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; code: ErrorCode; message: string };

const DENY = (code: ErrorCode, message: string): AccessDecision => ({
  allowed: false,
  code,
  message,
});

/** True when the shared link is dead for everyone, regardless of credentials. */
export function evaluateCompanionAvailability(
  state: CompanionAccessState,
  now: Date = new Date(),
): AccessDecision {
  if (state.workspaceSuspended) {
    return DENY('companion_revoked', 'This document is no longer available.');
  }
  if (state.revokedAt !== null || state.status === 'REVOKED') {
    return DENY('companion_revoked', 'This document is no longer available.');
  }
  if (state.status === 'ARCHIVED') {
    return DENY('companion_revoked', 'This document is no longer available.');
  }
  if (state.pausedAt !== null || state.status === 'PAUSED') {
    return DENY('companion_paused', 'This document is temporarily unavailable.');
  }
  if (isExpired(state.expiresAt, now) || state.status === 'EXPIRED') {
    return DENY('companion_expired', 'This link has expired.');
  }
  if (state.status === 'DRAFT' || state.status === 'PROCESSING') {
    return DENY('companion_not_ready', 'This document is still being prepared.');
  }
  if (state.status === 'FAILED') {
    return DENY('not_found', 'This document is no longer available.');
  }
  if (state.status !== 'ACTIVE') {
    return DENY('not_found', 'This document is no longer available.');
  }
  return { allowed: true };
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** Full check: availability plus the credentials this session has proven. */
export function evaluateRecipientAccess(
  state: CompanionAccessState,
  credentials: RecipientCredentials,
  now: Date = new Date(),
): AccessDecision {
  const availability = evaluateCompanionAvailability(state, now);
  if (!availability.allowed) return availability;

  switch (state.accessMode) {
    case 'PUBLIC':
      return { allowed: true };
    case 'PASSWORD':
      return credentials.passwordVerified
        ? { allowed: true }
        : DENY('password_required', 'This document is protected.');
    case 'EMAIL_LIST': {
      if (!credentials.verifiedEmail) {
        return DENY('identity_required', 'Confirm your email address to open this document.');
      }
      return isEmailAllowed(credentials.verifiedEmail, state.allowedEmails, state.allowedDomains)
        ? { allowed: true }
        : DENY('email_not_allowed', 'This document was not shared with that address.');
    }
    case 'IDENTIFIED':
      return credentials.verifiedEmail
        ? { allowed: true }
        : DENY('identity_required', 'Confirm your email address to open this document.');
    default:
      return DENY('forbidden', 'This document is no longer available.');
  }
}

export function isEmailAllowed(
  email: string,
  allowedEmails: string[],
  allowedDomains: string[],
): boolean {
  const normalized = email.trim().toLowerCase();
  if (allowedEmails.some((candidate) => candidate.trim().toLowerCase() === normalized)) {
    return true;
  }
  const at = normalized.lastIndexOf('@');
  if (at === -1) return false;
  const domain = normalized.slice(at + 1);
  return allowedDomains.some((candidate) => candidate.trim().toLowerCase() === domain);
}

/** Download requires everything a read requires, plus the download switch. */
export function evaluateDownloadAccess(
  state: CompanionAccessState,
  credentials: RecipientCredentials,
  now: Date = new Date(),
): AccessDecision {
  const read = evaluateRecipientAccess(state, credentials, now);
  if (!read.allowed) return read;
  return state.downloadAllowed
    ? { allowed: true }
    : DENY('download_disabled', 'Downloading is disabled for this document.');
}

/** Asking requires read access plus the AI switch being on. */
export function evaluateAskAccess(
  state: CompanionAccessState,
  credentials: RecipientCredentials,
  now: Date = new Date(),
): AccessDecision {
  const read = evaluateRecipientAccess(state, credentials, now);
  if (!read.allowed) return read;
  return state.aiEnabled
    ? { allowed: true }
    : DENY('forbidden', 'Questions are turned off for this document.');
}

export function assertAccess(decision: AccessDecision): void {
  if (!decision.allowed) {
    throw new AppError(decision.code, decision.message);
  }
}

export function resolveExpiration(
  preset: 'never' | '24h' | '7d' | '30d' | 'custom',
  custom: Date | null,
  now: Date = new Date(),
): Date | null {
  switch (preset) {
    case 'never':
      return null;
    case '24h':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    case 'custom':
      return custom;
    default:
      return null;
  }
}

/** How long before expiry the sender sees an "Expires soon" nudge. */
export const EXPIRES_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function expiresSoon(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= EXPIRES_SOON_WINDOW_MS;
}

/**
 * The status a Companion should present given stored fields and the clock.
 * Expiration is derived rather than written, so extending a date instantly
 * revives the same link without a background job.
 */
export function derivedStatus(
  stored: CompanionStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): CompanionStatus {
  if (stored === 'ACTIVE' && isExpired(expiresAt, now)) return 'EXPIRED';
  if (stored === 'EXPIRED' && !isExpired(expiresAt, now)) return 'ACTIVE';
  return stored;
}
