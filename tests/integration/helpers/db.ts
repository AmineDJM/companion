import { randomUUID } from 'node:crypto';
import { generateSlug } from '@companion/shared';
import { getDatabase, schema, sql, type Database } from '@companion/db';
import { runMigrations } from '@companion/db/migrate';

/**
 * Test fixtures.
 *
 * Every fixture writes real rows through the real schema, so a constraint or a
 * cascade the production code depends on is exercised here too.
 */
let database: Database | null = null;

export function db(): Database {
  // The same singleton the services under test use, so a fixture written here
  // is visible to them without a second pool and a second transaction view.
  database ??= getDatabase({ url: process.env['DATABASE_URL'] as string, max: 4 });
  return database;
}

export async function prepareDatabase(): Promise<void> {
  await runMigrations(process.env['DATABASE_URL'] as string);
}

/** Empties every table while keeping the schema, between test files. */
export async function truncateAll(): Promise<void> {
  const rows = await db().execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  `);
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  if (names.length === 0) return;
  await db().execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
}

export interface TenantFixture {
  workspaceId: string;
  userId: string;
  email: string;
}

export async function createTenant(label: string): Promise<TenantFixture> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;

  const [user] = await db()
    .insert(schema.users)
    .values({ email, name: label, emailVerifiedAt: new Date() })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('could not create the test user');

  const [workspace] = await db()
    .insert(schema.workspaces)
    .values({
      name: `${label} workspace`,
      slug: `${label}-${randomUUID().slice(0, 8)}`,
      ownerId: user.id,
    })
    .returning({ id: schema.workspaces.id });
  if (!workspace) throw new Error('could not create the test workspace');

  await db()
    .insert(schema.workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'OWNER' });

  return { workspaceId: workspace.id, userId: user.id, email };
}

export interface CompanionFixture {
  id: string;
  slug: string;
  workspaceId: string;
  fileId: string;
  fileVersionId: string;
  unitId: string;
}

export interface CompanionOverrides {
  accessMode: 'PUBLIC' | 'PASSWORD' | 'EMAIL_LIST' | 'IDENTIFIED';
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXPIRED' | 'PROCESSING';
  passwordHash: string | null;
  expiresAt: Date | null;
  allowDownload: boolean;
  title: string;
  allowedEmails: string[];
  allowedDomains: string[];
}

export async function createCompanion(
  tenant: TenantFixture,
  overrides: Partial<CompanionOverrides> = {},
): Promise<CompanionFixture> {
  // The product's own generator, so the unguessability test measures it.
  const slug = generateSlug();

  const [companion] = await db()
    .insert(schema.companions)
    .values({
      workspaceId: tenant.workspaceId,
      createdByUserId: tenant.userId,
      slug,
      name: overrides.title ?? 'Test document',
      status: overrides.status ?? 'ACTIVE',
      accessMode: overrides.accessMode ?? 'PUBLIC',
      expiresAt: overrides.expiresAt ?? null,
      downloadAllowed: overrides.allowDownload ?? true,
      publishedAt: new Date(),
    })
    .returning({ id: schema.companions.id });
  if (!companion) throw new Error('could not create the test companion');

  // Credentials live in their own table, exactly as the product writes them.
  if (
    overrides.passwordHash !== undefined ||
    overrides.allowedEmails !== undefined ||
    overrides.allowedDomains !== undefined
  ) {
    await db().insert(schema.companionAccessPolicies).values({
      companionId: companion.id,
      passwordHash: overrides.passwordHash ?? null,
      allowedEmails: overrides.allowedEmails ?? [],
      allowedDomains: overrides.allowedDomains ?? [],
    });
  }

  const [file] = await db()
    .insert(schema.files)
    .values({
      companionId: companion.id,
      name: 'contract.pdf',
      path: 'contract.pdf',
      extension: 'pdf',
      kind: 'PDF',
      status: 'READY',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
    })
    .returning({ id: schema.files.id });
  if (!file) throw new Error('could not create the test file');

  const [version] = await db()
    .insert(schema.fileVersions)
    .values({
      fileId: file.id,
      companionId: companion.id,
      version: 1,
      storageKey: `test/${companion.id}/contract.pdf`,
      contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      originalFilename: 'contract.pdf',
    })
    .returning({ id: schema.fileVersions.id });
  if (!version) throw new Error('could not create the test file version');

  const [unit] = await db()
    .insert(schema.documentUnits)
    .values({
      companionId: companion.id,
      fileId: file.id,
      fileVersionId: version.id,
      kind: 'PAGE',
      ordinal: 1,
      page: 1,
      text: 'The annual licence fee is EUR 50,000, payable in advance.',
      characterCount: 56,
    })
    .returning({ id: schema.documentUnits.id });
  if (!unit) throw new Error('could not create the test document unit');

  await db()
    .update(schema.files)
    .set({ currentVersionId: version.id, versionCount: 1 })
    .where(sql`${schema.files.id} = ${file.id}`);

  await db()
    .update(schema.companions)
    .set({ defaultFileId: file.id, fileCount: 1 })
    .where(sql`${schema.companions.id} = ${companion.id}`);

  return {
    id: companion.id,
    slug,
    workspaceId: tenant.workspaceId,
    fileId: file.id,
    fileVersionId: version.id,
    unitId: unit.id,
  };
}

export interface SessionOverrides {
  passwordVerifiedAt: Date | null;
  /** Set only once the address has actually been proven, never when claimed. */
  verifiedEmail: string | null;
}

export async function createRecipientSession(
  companionId: string,
  overrides: Partial<SessionOverrides> = {},
): Promise<string> {
  const [session] = await db()
    .insert(schema.recipientSessions)
    .values({
      companionId,
      tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      passwordVerifiedAt: overrides.passwordVerifiedAt ?? null,
      verifiedEmail: overrides.verifiedEmail ?? null,
      expiresAt: new Date(Date.now() + 86_400_000),
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning({ id: schema.recipientSessions.id });
  if (!session) throw new Error('could not create the test recipient session');
  return session.id;
}
