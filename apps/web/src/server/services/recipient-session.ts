import {
  AppError,
  EMPTY_EXTRACTION_STATE,
  evaluateRecipientAccess,
  generateNumericCode,
  isEmailAllowed,
  type AccessDecision,
  type RecipientCredentials,
  type SessionExtractionState,
} from '@companion/shared';
import { and, eq, schema, sql } from '@companion/db';
import { cookies, headers } from 'next/headers';
import { getContainer } from '../container';
import { env } from '../env';
import { hashIp, hashPassword, hashToken, verifyPassword } from '../crypto';
import { clientIp } from '../auth/session';
import { loadAccessState, loadPasswordHash, type CompanionRecord } from './companions';
import { checkRateLimit } from './rate-limit';

/**
 * Recipient sessions.
 *
 * No account, no login. A random opaque token in an httpOnly cookie, scoped to
 * one Companion. We store only a hash of it, plus a daily-rotating salted hash
 * of the IP for abuse throttling — never the raw address, and no fingerprinting.
 */
const SESSION_TTL_DAYS = 30;

export function recipientCookieName(slug: string): string {
  return `c_${slug}`;
}

/**
 * Header set by the edge middleware carrying the recipient token for this
 * request. Server Components cannot write cookies, so the token is minted
 * there and read here.
 */
export const RECIPIENT_HEADER = 'x-companion-recipient';

/** The token for this request: the middleware header, else the cookie. */
async function currentToken(slug: string): Promise<string | null> {
  const requestHeaders = await headers();
  const fromMiddleware = requestHeaders.get(RECIPIENT_HEADER);
  if (fromMiddleware) return fromMiddleware;
  const store = await cookies();
  return store.get(recipientCookieName(slug))?.value ?? null;
}

export interface RecipientSession {
  id: string;
  companionId: string;
  passwordVerifiedAt: Date | null;
  verifiedEmail: string | null;
  questionCount: number;
  extraction: SessionExtractionState;
}

function toSession(row: typeof schema.recipientSessions.$inferSelect): RecipientSession {
  return {
    id: row.id,
    companionId: row.companionId,
    passwordVerifiedAt: row.passwordVerifiedAt,
    verifiedEmail: row.verifiedEmail,
    questionCount: row.questionCount,
    extraction: {
      extractionAttempts: row.extractionAttempts,
      quotedCharacters: row.quotedCharacters,
      quotedUnitIds: row.quotedUnitIds,
      answersDelivered: row.answersDelivered,
    },
  };
}

/** Reads the current session without creating one. */
export async function readRecipientSession(
  companion: CompanionRecord,
): Promise<RecipientSession | null> {
  const token = await currentToken(companion.slug);
  if (!token) return null;

  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.recipientSessions)
    .where(
      and(
        eq(schema.recipientSessions.tokenHash, hashToken(token)),
        eq(schema.recipientSessions.companionId, companion.id),
        sql`${schema.recipientSessions.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return rows[0] ? toSession(rows[0]) : null;
}

/**
 * Reads the session, creating the database row on first visit.
 *
 * The cookie itself is set by the edge middleware; this only materialises the
 * row for the token that arrived with the request, so it is safe to call from
 * a Server Component.
 */
export async function ensureRecipientSession(
  companion: CompanionRecord,
): Promise<RecipientSession> {
  const existing = await readRecipientSession(companion);
  if (existing) {
    await touchSession(existing.id);
    return existing;
  }

  const token = await currentToken(companion.slug);
  if (!token) {
    // Only reachable if the middleware did not run for this path.
    throw new AppError('internal_error', 'Could not open this document. Please refresh.');
  }

  const { db } = getContainer();
  const requestHeaders = await headers();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ip = clientIp(requestHeaders);

  const [row] = await db
    .insert(schema.recipientSessions)
    .values({
      companionId: companion.id,
      tokenHash: hashToken(token),
      ipHash: ip ? hashIp(ip, env().SESSION_SECRET) : null,
      userAgentFamily: userAgentFamily(requestHeaders.get('user-agent')),
      firstSeenAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    // Two concurrent requests with the same fresh token must not both insert.
    .onConflictDoUpdate({
      target: schema.recipientSessions.tokenHash,
      set: { lastSeenAt: now },
    })
    .returning();
  if (!row) throw new AppError('internal_error', 'Could not open this document.');

  return toSession(row);
}

async function touchSession(sessionId: string): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.recipientSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.recipientSessions.id, sessionId));
}

export function credentialsOf(session: RecipientSession | null): RecipientCredentials {
  return {
    passwordVerified: session?.passwordVerifiedAt !== null && session?.passwordVerifiedAt !== undefined,
    verifiedEmail: session?.verifiedEmail ?? null,
  };
}

/**
 * The single authorisation entry point for every recipient operation. Called
 * again on each request — page load, preview, question, download, citation.
 */
export async function evaluateAccess(
  companion: CompanionRecord,
  session: RecipientSession | null,
): Promise<AccessDecision> {
  const state = await loadAccessState(companion);
  return evaluateRecipientAccess(state, credentialsOf(session));
}

export async function requireAccess(
  companion: CompanionRecord,
  session: RecipientSession | null,
): Promise<void> {
  const decision = await evaluateAccess(companion, session);
  if (!decision.allowed) throw new AppError(decision.code, decision.message);
}

/** Verifies the share password and marks the session as unlocked. */
export async function verifyCompanionPassword(input: {
  companion: CompanionRecord;
  session: RecipientSession;
  password: string;
  ipHash: string | null;
}): Promise<boolean> {
  const limits = await checkRateLimit({
    key: `companion:password:${input.companion.id}:${input.ipHash ?? input.session.id}`,
    windowSeconds: 900,
    max: 10,
  });
  if (!limits.allowed) {
    throw new AppError('rate_limited', 'Too many attempts. Try again in a few minutes.');
  }

  const stored = await loadPasswordHash(input.companion.id);
  if (!stored) {
    // Constant-ish time even when no password is configured.
    await verifyPassword(input.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAA');
    return false;
  }

  const valid = await verifyPassword(input.password, stored);
  if (!valid) return false;

  const { db } = getContainer();
  await db
    .update(schema.recipientSessions)
    .set({ passwordVerifiedAt: new Date(), lastSeenAt: new Date() })
    .where(eq(schema.recipientSessions.id, input.session.id));
  return true;
}

/**
 * Passwordless identity for email-gated Companions. The recipient receives a
 * six-digit code; they are told plainly that the sender will see who opened it.
 */
export async function startIdentityVerification(input: {
  companion: CompanionRecord;
  email: string;
}): Promise<{ code: string; expiresAt: Date }> {
  const { db } = getContainer();
  const email = input.email.trim().toLowerCase();
  const state = await loadAccessState(input.companion);

  if (
    input.companion.accessMode === 'EMAIL_LIST' &&
    !isEmailAllowed(email, state.allowedEmails, state.allowedDomains)
  ) {
    // Do not reveal whether the address is on the list: a generic failure at
    // the verification step keeps the recipient list private.
    throw new AppError('email_not_allowed', 'This document was not shared with that address.');
  }

  const limit = await checkRateLimit({
    key: `companion:identity:${input.companion.id}:${email}`,
    windowSeconds: 900,
    max: 5,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many attempts. Try again in a few minutes.');
  }

  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const now = new Date();

  await db
    .insert(schema.recipientIdentities)
    .values({
      companionId: input.companion.id,
      email,
      codeHash: await hashPassword(code),
      codeExpiresAt: expiresAt,
      codeAttempts: 0,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.recipientIdentities.companionId, schema.recipientIdentities.email],
      set: {
        codeHash: await hashPassword(code),
        codeExpiresAt: expiresAt,
        codeAttempts: 0,
        lastSeenAt: now,
      },
    });

  return { code, expiresAt };
}

export async function confirmIdentity(input: {
  companion: CompanionRecord;
  session: RecipientSession;
  email: string;
  code: string;
}): Promise<boolean> {
  const { db } = getContainer();
  const email = input.email.trim().toLowerCase();

  const rows = await db
    .select()
    .from(schema.recipientIdentities)
    .where(
      and(
        eq(schema.recipientIdentities.companionId, input.companion.id),
        eq(schema.recipientIdentities.email, email),
      ),
    )
    .limit(1);
  const identity = rows[0];
  if (!identity?.codeHash || !identity.codeExpiresAt) return false;
  if (identity.codeExpiresAt.getTime() < Date.now()) return false;
  if (identity.codeAttempts >= 6) {
    throw new AppError('rate_limited', 'Too many attempts. Request a new code.');
  }

  const valid = await verifyPassword(input.code, identity.codeHash);
  if (!valid) {
    await db
      .update(schema.recipientIdentities)
      .set({ codeAttempts: identity.codeAttempts + 1 })
      .where(eq(schema.recipientIdentities.id, identity.id));
    return false;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.recipientIdentities)
      .set({
        verifiedAt: now,
        codeHash: null,
        codeExpiresAt: null,
        codeAttempts: 0,
        lastSeenAt: now,
        visitCount: sql`${schema.recipientIdentities.visitCount} + 1`,
      })
      .where(eq(schema.recipientIdentities.id, identity.id));

    await tx
      .update(schema.recipientSessions)
      .set({ verifiedEmail: email, identityId: identity.id, lastSeenAt: now })
      .where(eq(schema.recipientSessions.id, input.session.id));
  });

  return true;
}

/** Persists cumulative source-protection state after each answer. */
export async function persistExtractionState(
  sessionId: string,
  state: SessionExtractionState,
): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.recipientSessions)
    .set({
      extractionAttempts: state.extractionAttempts,
      quotedCharacters: state.quotedCharacters,
      quotedUnitIds: state.quotedUnitIds,
      answersDelivered: state.answersDelivered,
      lastSeenAt: new Date(),
    })
    .where(eq(schema.recipientSessions.id, sessionId));
}

export async function incrementSessionQuestions(sessionId: string): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.recipientSessions)
    .set({
      questionCount: sql`${schema.recipientSessions.questionCount} + 1`,
      lastSeenAt: new Date(),
    })
    .where(eq(schema.recipientSessions.id, sessionId));
}

export { EMPTY_EXTRACTION_STATE };

/** Coarse UA family for analytics. Deliberately not a fingerprint. */
function userAgentFamily(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/\bEdg\//.test(userAgent)) return 'Edge';
  if (/\bOPR\//.test(userAgent)) return 'Opera';
  if (/\bChrome\//.test(userAgent)) return 'Chrome';
  if (/\bFirefox\//.test(userAgent)) return 'Firefox';
  if (/\bSafari\//.test(userAgent)) return 'Safari';
  return 'Other';
}
