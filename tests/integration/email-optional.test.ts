import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@companion/db';
import {
  createCompanion,
  createTenant,
  db,
  prepareDatabase,
  truncateAll,
  type TenantFixture,
} from './helpers/db';

/**
 * Email is optional, and must stay that way.
 *
 * Companion does not deliver share links: a sender creates a Companion, copies
 * the link and sends it through whatever their recipient already uses. So the
 * core path — upload, attach, copy link, open, ask — must run on an instance
 * with no mail provider at all, and readiness must not call that a broken
 * deployment.
 */
const { productionReadiness } = await import('../../apps/web/src/server/services/readiness');
const { setEnvForTesting, loadEnv } = await import('../../apps/web/src/server/env');
const { resetEmailProvider, emailDeliveryAvailable } = await import(
  '../../apps/web/src/server/email'
);

// Captured as values, not a spread: assigning `undefined` back to process.env
// stores the string "undefined", which the schema then rejects for every test
// file that shares this worker.
const ORIGINAL = {
  provider: process.env['EMAIL_PROVIDER'],
  resendKey: process.env['RESEND_API_KEY'],
};

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function withEmailProvider(value: 'none' | 'resend'): Promise<void> {
  process.env['EMAIL_PROVIDER'] = value;
  if (value === 'resend') process.env['RESEND_API_KEY'] = 'test-key-not-used';
  else delete process.env['RESEND_API_KEY'];
  setEnvForTesting(loadEnv(process.env));
  resetEmailProvider();
}

function emailCheckOf(report: Awaited<ReturnType<typeof productionReadiness>>) {
  const check = report.checks.find((entry) => entry.id === 'email');
  if (!check) throw new Error('readiness has no email check');
  return check;
}

let sender: TenantFixture;

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  sender = await createTenant('email-optional');
  await withEmailProvider('none');
});

afterAll(async () => {
  restore('EMAIL_PROVIDER', ORIGINAL.provider);
  restore('RESEND_API_KEY', ORIGINAL.resendKey);
  setEnvForTesting(null);
  resetEmailProvider();
  await truncateAll();
});

describe('an instance with no mail provider', () => {
  it('reports delivery as unavailable', () => {
    expect(emailDeliveryAvailable()).toBe(false);
  });

  it('passes readiness: nothing in the core path needs email', async () => {
    const report = await productionReadiness();
    const check = emailCheckOf(report);

    expect(check.status).toBe('PASS');
    expect(check.detail).toContain('nothing needs it');
  });

  it('never makes email a blocking failure', async () => {
    const report = await productionReadiness();
    const blocking = report.checks.filter((entry) => entry.status === 'CRITICAL');
    expect(blocking.map((entry) => entry.id)).not.toContain('email');
  });

  it('still serves a public link, which is the whole distribution model', async () => {
    const companion = await createCompanion(sender, { accessMode: 'PUBLIC' });

    const rows = await db()
      .select({ slug: schema.companions.slug, accessMode: schema.companions.accessMode })
      .from(schema.companions)
      .where(eq(schema.companions.id, companion.id))
      .limit(1);

    expect(rows[0]?.slug).toBeTruthy();
    expect(rows[0]?.accessMode).toBe('PUBLIC');
  });

  it('still serves a password-protected link', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PASSWORD',
      passwordHash: 'scrypt$placeholder$placeholder',
    });
    expect(companion.slug).toBeTruthy();
  });
});

describe('when a Companion does depend on delivery', () => {
  it('warns rather than passing, because those recipients are locked out', async () => {
    await createCompanion(sender, { accessMode: 'IDENTIFIED' });

    const check = emailCheckOf(await productionReadiness());
    expect(check.status).toBe('WARNING');
    expect(check.detail).toContain("confirm a recipient's address");
    expect(check.remediation).toContain('switch');
  });

  it('counts an email-list Companion too', async () => {
    await createCompanion(sender, { accessMode: 'EMAIL_LIST', allowedEmails: ['a@b.test'] });

    expect(emailCheckOf(await productionReadiness()).status).toBe('WARNING');
  });

  it('ignores a deleted Companion, which locks nobody out', async () => {
    const companion = await createCompanion(sender, { accessMode: 'IDENTIFIED' });
    await db()
      .update(schema.companions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.companions.id, companion.id));

    expect(emailCheckOf(await productionReadiness()).status).toBe('PASS');
  });
});

describe('when a provider is configured', () => {
  it('passes with nothing sent yet, rather than nagging', async () => {
    await withEmailProvider('resend');
    const check = emailCheckOf(await productionReadiness());

    expect(check.status).toBe('PASS');
    expect(check.detail).toContain('Resend');
  });

  it('reports delivery as available', async () => {
    await withEmailProvider('resend');
    expect(emailDeliveryAvailable()).toBe(true);
  });
});
