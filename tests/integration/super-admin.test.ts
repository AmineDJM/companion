import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@companion/db';
import { createTenant, db, prepareDatabase, truncateAll } from './helpers/db';

/**
 * Super Admin bootstrap recovery.
 *
 * The failure this guards against is procedural, not technical: you deploy,
 * you register, and only then remember SUPER_ADMIN_EMAILS. If the only way
 * back in were a SQL console, the console would be unreachable exactly when
 * you most need it.
 */
const { ensureSuperAdmin, syncSuperAdmins, configuredSuperAdminEmails, activeSuperAdminCount } =
  await import('../../apps/web/src/server/auth/super-admin');

async function roleOf(userId: string): Promise<string> {
  const rows = await db()
    .select({ platformRole: schema.users.platformRole })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.platformRole ?? 'missing';
}

async function auditEntries(userId: string) {
  return db()
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.targetId, userId));
}

const ORIGINAL = process.env['SUPER_ADMIN_EMAILS'];

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  delete process.env['SUPER_ADMIN_EMAILS'];
});

afterAll(async () => {
  if (ORIGINAL === undefined) delete process.env['SUPER_ADMIN_EMAILS'];
  else process.env['SUPER_ADMIN_EMAILS'] = ORIGINAL;
  await truncateAll();
});

/** The env module caches, so tests install configuration through the seam. */
async function withAllowlist(value: string): Promise<void> {
  process.env['SUPER_ADMIN_EMAILS'] = value;
  const { setEnvForTesting, loadEnv } = await import('../../apps/web/src/server/env');
  setEnvForTesting(loadEnv(process.env));
}

describe('configuredSuperAdminEmails', () => {
  it('accepts commas, semicolons and whitespace', () => {
    expect(configuredSuperAdminEmails('a@x.test, b@x.test;c@x.test  d@x.test')).toEqual([
      'a@x.test',
      'b@x.test',
      'c@x.test',
      'd@x.test',
    ]);
  });

  it('normalises case and drops duplicates', () => {
    expect(configuredSuperAdminEmails('A@X.test,a@x.TEST')).toEqual(['a@x.test']);
  });

  it('is empty when nothing is configured', () => {
    expect(configuredSuperAdminEmails(undefined)).toEqual([]);
  });
});

describe('recovering an account that already existed', () => {
  it('promotes a normal user once the allowlist names them', async () => {
    const tenant = await createTenant('late');
    expect(await roleOf(tenant.userId)).toBe('user');

    await withAllowlist(tenant.email);
    const granted = await ensureSuperAdmin({
      userId: tenant.userId,
      email: tenant.email,
      currentRole: 'user',
      reason: 'session',
    });

    expect(granted).toBe(true);
    expect(await roleOf(tenant.userId)).toBe('super_admin');
  });

  it('records the promotion in the audit log', async () => {
    const tenant = await createTenant('audited');
    await withAllowlist(tenant.email);
    await ensureSuperAdmin({
      userId: tenant.userId,
      email: tenant.email,
      currentRole: 'user',
      reason: 'session',
    });

    const entries = await auditEntries(tenant.userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('admin.role_bootstrapped');
    expect(entries[0]?.metadata).toMatchObject({ source: 'SUPER_ADMIN_EMAILS', trigger: 'session' });
  });

  it('is idempotent: a second pass promotes nobody', async () => {
    const tenant = await createTenant('idempotent');
    await withAllowlist(tenant.email);

    const first = await syncSuperAdmins();
    const second = await syncSuperAdmins();

    expect(first.promoted.map((entry) => entry.email)).toEqual([tenant.email.toLowerCase()]);
    expect(second.promoted).toHaveLength(0);
    expect(second.unchanged).toEqual([tenant.email.toLowerCase()]);
    expect(await auditEntries(tenant.userId)).toHaveLength(1);
  });

  it('ignores an address that is not on the allowlist', async () => {
    const listed = await createTenant('listed');
    const other = await createTenant('other');
    await withAllowlist(listed.email);

    await syncSuperAdmins();

    expect(await roleOf(listed.userId)).toBe('super_admin');
    expect(await roleOf(other.userId)).toBe('user');
  });

  it('reports a listed address that has not registered yet', async () => {
    await withAllowlist('nobody@example.test');
    const result = await syncSuperAdmins();

    expect(result.pending).toEqual(['nobody@example.test']);
    expect(result.promoted).toHaveLength(0);
  });

  it('does not hand the console to a deleted account', async () => {
    const tenant = await createTenant('deleted');
    await db()
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, tenant.userId));

    await withAllowlist(tenant.email);
    await syncSuperAdmins();

    expect(await roleOf(tenant.userId)).toBe('user');
  });
});

describe('never demoting', () => {
  it('leaves an existing Super Admin alone when the allowlist changes', async () => {
    const tenant = await createTenant('kept');
    await withAllowlist(tenant.email);
    await syncSuperAdmins();
    expect(await roleOf(tenant.userId)).toBe('super_admin');

    // A typo in an environment variable must not be able to lock everyone out.
    await withAllowlist('someone.else@example.test');
    await syncSuperAdmins();

    expect(await roleOf(tenant.userId)).toBe('super_admin');
  });

  it('writes nothing when the account already holds the role', async () => {
    const tenant = await createTenant('already');
    await withAllowlist(tenant.email);
    await syncSuperAdmins();

    const granted = await ensureSuperAdmin({
      userId: tenant.userId,
      email: tenant.email,
      currentRole: 'super_admin',
      reason: 'session',
    });

    expect(granted).toBe(false);
    expect(await auditEntries(tenant.userId)).toHaveLength(1);
  });
});

describe('dry run', () => {
  it('reports what would change without changing it', async () => {
    const tenant = await createTenant('dry');
    await withAllowlist(tenant.email);

    const result = await syncSuperAdmins({ dryRun: true });

    expect(result.promoted.map((entry) => entry.email)).toEqual([tenant.email.toLowerCase()]);
    expect(await roleOf(tenant.userId)).toBe('user');
    expect(await auditEntries(tenant.userId)).toHaveLength(0);
  });
});

describe('activeSuperAdminCount', () => {
  it('counts what is persisted, not what is configured', async () => {
    expect(await activeSuperAdminCount()).toBe(0);

    const tenant = await createTenant('counted');
    await withAllowlist(`${tenant.email}, never-registered@example.test`);
    await syncSuperAdmins();

    // Two configured, one real account: the number that matters is one.
    expect(await activeSuperAdminCount()).toBe(1);
  });
});
