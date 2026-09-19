import { AppError, DEFAULT_BRANDING } from '@companion/shared';
import { and, eq, gt, schema, sql } from '@companion/db';
import { getContainer } from '../container';
import { env } from '../env';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../crypto';
import { recordAudit } from '../services/audit';
import { createSession, revokeAllSessions, uniqueWorkspaceSlug } from './session';
import { checkRateLimit } from '../services/rate-limit';

export interface AccountCreationResult {
  userId: string;
  workspaceId: string;
}

/**
 * Creates a user, their personal workspace and the owning membership in a
 * single transaction. A half-created account with no workspace would strand the
 * user on every authenticated page, so this is all-or-nothing.
 */
export async function createAccount(input: {
  email: string;
  password?: string;
  name?: string;
  googleSubject?: string;
  emailVerified?: boolean;
}): Promise<AccountCreationResult> {
  const { db } = getContainer();
  const email = input.email.trim().toLowerCase();

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AppError('conflict', 'An account already exists for that email address.');
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const workspaceName = input.name?.trim() || email.split('@')[0] || 'My workspace';
  const slug = await uniqueWorkspaceSlug(workspaceName);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email,
        name: input.name?.trim() || null,
        passwordHash,
        googleSubject: input.googleSubject ?? null,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        platformRole: 'user',
        lastSeenAt: new Date(),
      })
      .returning({ id: schema.users.id });
    if (!user) throw new AppError('internal_error', 'Could not create the account.');

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({
        name: workspaceName,
        slug,
        ownerId: user.id,
        planKey: 'free',
        branding: DEFAULT_BRANDING,
        billingAnchorAt: new Date(),
      })
      .returning({ id: schema.workspaces.id });
    if (!workspace) throw new AppError('internal_error', 'Could not create the workspace.');

    await tx.insert(schema.workspaceMembers).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      acceptedAt: new Date(),
    });

    return { userId: user.id, workspaceId: workspace.id };
  });
}

export async function findUserByEmail(email: string) {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Password sign-in. Rate limited per email, and the failure message never
 * distinguishes "no such account" from "wrong password".
 */
export async function signInWithPassword(input: {
  email: string;
  password: string;
  ipHash: string | null;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const limit = await checkRateLimit({
    key: `auth:password:${email}`,
    windowSeconds: 900,
    max: 10,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many attempts. Try again in a few minutes.');
  }

  const user = await findUserByEmail(email);
  const genericFailure = new AppError('unauthorized', 'That email or password is not correct.');

  if (!user?.passwordHash) {
    // Burn comparable time so a missing account is not detectable by timing.
    await verifyPassword(input.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAA');
    throw genericFailure;
  }
  if (user.suspendedAt || user.deletedAt) throw genericFailure;

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw genericFailure;

  await createSession(user.id);
  return user.id;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { db } = getContainer();
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new AppError('not_found', 'Account not found.');

  if (user.passwordHash) {
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('unauthorized', 'That password is not correct.');
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  // Any stolen session must not survive a password change.
  await revokeAllSessions(userId);
  await recordAudit({
    action: 'user.password_changed',
    actorType: 'user',
    actorUserId: userId,
    targetType: 'user',
    targetId: userId,
  });
}

export type TokenPurpose = 'magic_link' | 'email_verify' | 'password_reset';

const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  magic_link: 15,
  email_verify: 60 * 24,
  password_reset: 30,
};

export async function issueAuthToken(input: {
  email: string;
  purpose: TokenPurpose;
  userId?: string | null;
  payload?: Record<string, string>;
}): Promise<string> {
  const { db } = getContainer();
  const token = randomToken(32);
  const email = input.email.trim().toLowerCase();

  await db.insert(schema.authTokens).values({
    userId: input.userId ?? null,
    email,
    purpose: input.purpose,
    tokenHash: hashToken(token),
    payload: input.payload ?? null,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES[input.purpose] * 60 * 1000),
  });

  return token;
}

export interface ConsumedToken {
  email: string;
  userId: string | null;
  payload: Record<string, string> | null;
}

/**
 * Single-use token consumption. The update is conditional on `consumed_at`
 * still being null, so two concurrent clicks cannot both succeed.
 */
export async function consumeAuthToken(
  token: string,
  purpose: TokenPurpose,
): Promise<ConsumedToken> {
  const { db } = getContainer();
  const now = new Date();
  const rows = await db
    .update(schema.authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.authTokens.tokenHash, hashToken(token)),
        eq(schema.authTokens.purpose, purpose),
        sql`${schema.authTokens.consumedAt} IS NULL`,
        gt(schema.authTokens.expiresAt, now),
      ),
    )
    .returning({
      email: schema.authTokens.email,
      userId: schema.authTokens.userId,
      payload: schema.authTokens.payload,
    });

  const row = rows[0];
  if (!row) throw new AppError('unauthorized', 'That link is no longer valid. Request a new one.');
  return { email: row.email, userId: row.userId, payload: row.payload ?? null };
}

/**
 * Completes a magic-link sign-in, creating the account on first use so a new
 * visitor never has to fill in a password at all.
 */
export async function completeMagicLink(token: string): Promise<{
  userId: string;
  payload: Record<string, string> | null;
  created: boolean;
}> {
  const { db } = getContainer();
  const consumed = await consumeAuthToken(token, 'magic_link');

  const existing = await findUserByEmail(consumed.email);
  if (existing) {
    if (existing.suspendedAt || existing.deletedAt) {
      throw new AppError('forbidden', 'This account is not available.');
    }
    if (!existing.emailVerifiedAt) {
      await db
        .update(schema.users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(schema.users.id, existing.id));
    }
    await createSession(existing.id);
    return { userId: existing.id, payload: consumed.payload, created: false };
  }

  const created = await createAccount({ email: consumed.email, emailVerified: true });
  await applySuperAdminBootstrap(consumed.email, created.userId);
  await createSession(created.userId);
  return { userId: created.userId, payload: consumed.payload, created: true };
}

/**
 * Promotes an account listed in SUPER_ADMIN_EMAILS at creation time. This is
 * the only place the role is granted outside the explicit admin UI, and it is
 * driven purely by server-side configuration.
 */
export async function applySuperAdminBootstrap(email: string, userId: string): Promise<boolean> {
  const configured = (env().SUPER_ADMIN_EMAILS ?? '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!configured.includes(email.trim().toLowerCase())) return false;

  const { db } = getContainer();
  await db
    .update(schema.users)
    .set({ platformRole: 'super_admin', updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await recordAudit({
    action: 'admin.role_bootstrapped',
    actorType: 'system',
    targetType: 'user',
    targetId: userId,
    metadata: { source: 'SUPER_ADMIN_EMAILS' },
  });
  return true;
}
