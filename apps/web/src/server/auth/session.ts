import { AppError, generateSlug } from '@companion/shared';
import { and, eq, gt, isNull, schema, sql } from '@companion/db';
import { cookies, headers } from 'next/headers';
import { getContainer } from '../container';
import { ensureSuperAdmin } from './super-admin';
import { env, isProduction } from '../env';
import { hashIp, hashToken, randomToken } from '../crypto';

export const SESSION_COOKIE = 'companion_session';
const SESSION_TTL_DAYS = 30;
/** Sessions are refreshed at most once an hour to avoid a write per request. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  platformRole: 'user' | 'support' | 'super_admin';
  emailVerifiedAt: Date | null;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  slug: string;
  planKey: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'suspended';
}

export interface AuthContext {
  user: AuthenticatedUser;
  workspace: SessionWorkspace;
  sessionId: string;
}

/** Creates a session and returns the raw cookie value (stored only as a hash). */
export async function createSession(userId: string): Promise<string> {
  const { db } = getContainer();
  const token = randomToken(32);
  const requestHeaders = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(schema.authSessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: requestHeaders.get('user-agent')?.slice(0, 400) ?? null,
    ipHash: hashClientIp(requestHeaders),
    expiresAt,
    lastUsedAt: new Date(),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const { db } = getContainer();
    await db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.authSessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Revokes every session for a user, e.g. after a password change or suspension. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)));
}

/**
 * Resolves the caller from the session cookie. Returns null rather than
 * throwing so public pages can render an anonymous view.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { db } = getContainer();
  const rows = await db
    .select({
      sessionId: schema.authSessions.id,
      lastUsedAt: schema.authSessions.lastUsedAt,
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      platformRole: schema.users.platformRole,
      emailVerifiedAt: schema.users.emailVerifiedAt,
      suspendedAt: schema.users.suspendedAt,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(
      and(
        eq(schema.authSessions.tokenHash, hashToken(token)),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.suspendedAt || row.deletedAt) return null;

  // Reconcile the allowlist against what is persisted. Costs one string
  // comparison against cached configuration in the overwhelming case; the
  // write happens at most once per account, and never demotes.
  const promoted = await ensureSuperAdmin({
    userId: row.userId,
    email: row.email,
    currentRole: row.platformRole,
    reason: 'session',
  });
  const platformRole = promoted ? ('super_admin' as const) : row.platformRole;

  const workspace = await resolveWorkspace(row.userId);
  if (!workspace) return null;

  // Refresh the activity stamp at most hourly.
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > REFRESH_INTERVAL_MS) {
    await db
      .update(schema.authSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.authSessions.id, row.sessionId));
    await db
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, row.userId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
      platformRole,
      emailVerifiedAt: row.emailVerifiedAt,
    },
    workspace,
  };
}

/** Throws rather than returning null; use in every protected route handler. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new AppError('unauthorized', 'Sign in to continue.');
  if (context.workspace.status === 'suspended') {
    throw new AppError('forbidden', 'This workspace is suspended. Contact support.');
  }
  return context;
}

/**
 * Super-admin gate. Authorisation is checked server-side on every admin
 * request; hiding navigation is never treated as a control.
 */
export async function requireSuperAdmin(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new AppError('unauthorized', 'Sign in to continue.');
  if (context.user.platformRole !== 'super_admin') {
    // Deliberately indistinguishable from a missing page.
    throw new AppError('not_found', 'Not found.');
  }
  return context;
}

async function resolveWorkspace(userId: string): Promise<SessionWorkspace | null> {
  const { db } = getContainer();
  const rows = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
      planKey: schema.workspaces.planKey,
      status: schema.workspaces.status,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(
      and(eq(schema.workspaceMembers.userId, userId), isNull(schema.workspaces.deletedAt)),
    )
    .orderBy(schema.workspaceMembers.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

export function hashClientIp(requestHeaders: Headers): string | null {
  const ip = clientIp(requestHeaders);
  if (!ip) return null;
  return hashIp(ip, env().SESSION_SECRET);
}

export function clientIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return requestHeaders.get('x-real-ip') ?? requestHeaders.get('cf-connecting-ip');
}

/** Generates a unique workspace slug, retrying on the rare collision. */
export async function uniqueWorkspaceSlug(base: string): Promise<string> {
  const { db } = getContainer();
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${generateSlug(4).toLowerCase()}`;
    const existing = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Counts sessions for the account page. */
export async function activeSessionCount(userId: string): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.authSessions)
    .where(
      and(
        eq(schema.authSessions.userId, userId),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, new Date()),
      ),
    );
  return rows[0]?.value ?? 0;
}
