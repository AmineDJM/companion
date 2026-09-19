import { eq, inArray, schema } from '@companion/db';
import { getContainer } from '../container';
import { env } from '../env';
import { recordAudit } from '../services/audit';

/**
 * Super Admin bootstrap.
 *
 * `SUPER_ADMIN_EMAILS` is an allowlist for *granting* the role, never a
 * substitute for checking it. Every `/admin` request still reads the persisted
 * `platform_role`; this module is only how that column comes to say
 * `super_admin` in the first place.
 *
 * It is deliberately recoverable. Adding an address after the account already
 * exists is the normal case — you deploy, you sign up, you realise you forgot
 * the variable — and it must not require a SQL console to fix. So the
 * allowlist is reconciled whenever the account is seen, and by an explicit
 * command when you would rather not wait.
 *
 * It never demotes. Removing an address from the allowlist does not revoke
 * anyone: that would make a typo in an environment variable capable of locking
 * every operator out of the console at once. Revocation is a deliberate action
 * in the admin UI.
 */
export interface SuperAdminSyncResult {
  /** Addresses in the allowlist, normalised. */
  configured: string[];
  /** Accounts promoted by this call. */
  promoted: { userId: string; email: string }[];
  /** Already had the role; nothing to do. */
  unchanged: string[];
  /** Listed but no account exists yet; they are promoted when they register. */
  pending: string[];
}

/** Parses the allowlist. Tolerant of commas, semicolons and whitespace. */
export function configuredSuperAdminEmails(raw = env().SUPER_ADMIN_EMAILS): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[,\s;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function isConfiguredSuperAdmin(email: string): boolean {
  return configuredSuperAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Grants the role to one account, if the allowlist names it.
 *
 * Returns false without touching the database when the address is not listed
 * or the account already holds the role, so this is safe to call on a hot
 * path: the common case is a string comparison against cached configuration.
 */
export async function ensureSuperAdmin(input: {
  userId: string;
  email: string;
  currentRole: string;
  reason: 'registration' | 'session' | 'command';
}): Promise<boolean> {
  if (input.currentRole === 'super_admin') return false;
  if (!isConfiguredSuperAdmin(input.email)) return false;

  const { db, logger } = getContainer();
  await db
    .update(schema.users)
    .set({ platformRole: 'super_admin', updatedAt: new Date() })
    .where(eq(schema.users.id, input.userId));

  await recordAudit({
    action: 'admin.role_bootstrapped',
    actorType: 'system',
    targetType: 'user',
    targetId: input.userId,
    targetLabel: input.email,
    metadata: { source: 'SUPER_ADMIN_EMAILS', trigger: input.reason },
  });

  logger.info('super admin granted from allowlist', {
    userId: input.userId,
    trigger: input.reason,
  });
  return true;
}

/**
 * Reconciles the whole allowlist in one pass.
 *
 * Idempotent: running it twice promotes nobody the second time. Used by the
 * `admin:bootstrap` command and by the readiness report, which needs to know
 * whether anyone can actually reach the console.
 */
export async function syncSuperAdmins(
  options: { dryRun?: boolean } = {},
): Promise<SuperAdminSyncResult> {
  const configured = configuredSuperAdminEmails();
  const result: SuperAdminSyncResult = {
    configured,
    promoted: [],
    unchanged: [],
    pending: [],
  };
  if (configured.length === 0) return result;

  const { db } = getContainer();
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      platformRole: schema.users.platformRole,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.email, configured));

  const seen = new Set<string>();
  for (const row of rows) {
    const email = row.email.toLowerCase();
    seen.add(email);
    // A deleted account is not a route back into the console.
    if (row.deletedAt) continue;
    if (row.platformRole === 'super_admin') {
      result.unchanged.push(email);
      continue;
    }
    if (options.dryRun) {
      result.promoted.push({ userId: row.id, email });
      continue;
    }
    const granted = await ensureSuperAdmin({
      userId: row.id,
      email: row.email,
      currentRole: row.platformRole,
      reason: 'command',
    });
    if (granted) result.promoted.push({ userId: row.id, email });
  }

  result.pending = configured.filter((email) => !seen.has(email));
  return result;
}

/** Accounts that currently hold the role, whatever granted it. */
export async function activeSuperAdminCount(): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.platformRole, 'super_admin'));
  return rows.filter(Boolean).length;
}
