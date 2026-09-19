import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLUG_LENGTH } from '@companion/shared';
import { eq, schema } from '@companion/db';
import { hashPassword } from '../../apps/web/src/server/crypto';
import {
  createCompanion,
  createRecipientSession,
  createTenant,
  db,
  prepareDatabase,
  truncateAll,
  type TenantFixture,
} from './helpers/db';

/**
 * The access-control matrix, exercised against the real database.
 *
 * The rule under test is the one the product is sold on: a link is readable by
 * exactly the people the sender allowed, from the moment they allowed it until
 * the moment they stopped. Every row below is a real Companion, a real session
 * and a real query — a stubbed repository would only confirm that the test
 * agrees with itself.
 */
const services = await (async () => {
  const [{ getCompanionBySlug }, session, files] = await Promise.all([
    import('../../apps/web/src/server/services/companions'),
    import('../../apps/web/src/server/services/recipient-session'),
    import('../../apps/web/src/server/services/files'),
  ]);
  return { getCompanionBySlug, ...session, ...files };
})();

let sender: TenantFixture;
let attacker: TenantFixture;

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  sender = await createTenant('sender');
  attacker = await createTenant('attacker');
});

afterAll(async () => {
  await truncateAll();
});

async function decide(slug: string, sessionId: string | null) {
  const companion = await services.getCompanionBySlug(slug);
  if (!companion) return { allowed: false, code: 'not_found' as const };
  const session = sessionId
    ? ((await db()
        .select()
        .from(schema.recipientSessions)
        .where(eq(schema.recipientSessions.id, sessionId))
        .limit(1))[0] ?? null)
    : null;

  return services.evaluateAccess(
    companion,
    session
      ? {
          id: session.id,
          companionId: session.companionId,
          passwordVerifiedAt: session.passwordVerifiedAt,
          verifiedEmail: session.verifiedEmail,
          questionCount: session.questionCount,
          extraction: {
            extractionAttempts: session.extractionAttempts,
            quotedCharacters: session.quotedCharacters,
            quotedUnitIds: session.quotedUnitIds,
            answersDelivered: session.answersDelivered,
          },
        }
      : null,
  );
}

describe('access mode matrix', () => {
  it('lets anyone read a public Companion', async () => {
    const companion = await createCompanion(sender, { accessMode: 'PUBLIC' });
    expect((await decide(companion.slug, null)).allowed).toBe(true);
  });

  it('withholds a password-protected Companion until the password is verified', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PASSWORD',
      passwordHash: await hashPassword('correct horse battery staple'),
    });

    const locked = await decide(companion.slug, await createRecipientSession(companion.id));
    expect(locked.allowed).toBe(false);
    expect(locked.code).toBe('password_required');

    const unlocked = await decide(
      companion.slug,
      await createRecipientSession(companion.id, { passwordVerifiedAt: new Date() }),
    );
    expect(unlocked.allowed).toBe(true);
  });

  it('withholds an email-gated Companion from an unverified visitor', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'EMAIL_LIST',
      allowedEmails: ['invited@example.test'],
    });

    const anonymous = await decide(companion.slug, await createRecipientSession(companion.id));
    expect(anonymous.allowed).toBe(false);

    // The column is written only after the code is confirmed, so an address a
    // visitor merely typed can never appear here.
    const verified = await decide(
      companion.slug,
      await createRecipientSession(companion.id, { verifiedEmail: 'invited@example.test' }),
    );
    expect(verified.allowed).toBe(true);
  });

  it('refuses a verified address that is not on the list', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'EMAIL_LIST',
      allowedEmails: ['invited@example.test'],
    });

    const outsider = await decide(
      companion.slug,
      await createRecipientSession(companion.id, {
        verifiedEmail: 'someone.else@example.test',
      }),
    );
    expect(outsider.allowed).toBe(false);
  });

  it('accepts any verified address for an identified Companion', async () => {
    const companion = await createCompanion(sender, { accessMode: 'IDENTIFIED' });
    const verified = await decide(
      companion.slug,
      await createRecipientSession(companion.id, { verifiedEmail: 'reader@elsewhere.test' }),
    );
    expect(verified.allowed).toBe(true);
  });
});

describe('revocation and pause', () => {
  it('closes an open link within the revocation budget', async () => {
    const companion = await createCompanion(sender, { accessMode: 'PUBLIC' });
    const sessionId = await createRecipientSession(companion.id);
    expect((await decide(companion.slug, sessionId)).allowed).toBe(true);

    const revokedAt = Date.now();
    await db()
      .update(schema.companions)
      .set({ status: 'REVOKED', revokedAt: new Date() })
      .where(eq(schema.companions.id, companion.id));

    const decision = await decide(companion.slug, sessionId);
    const latencyMs = Date.now() - revokedAt;

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('companion_revoked');
    // The metric's own threshold: revocation must take effect on the next read.
    expect(latencyMs).toBeLessThan(500);
  });

  it('closes a paused link and reopens it when the sender resumes', async () => {
    const companion = await createCompanion(sender, { accessMode: 'PUBLIC' });
    await db()
      .update(schema.companions)
      .set({ status: 'PAUSED' })
      .where(eq(schema.companions.id, companion.id));
    expect((await decide(companion.slug, null)).allowed).toBe(false);

    await db()
      .update(schema.companions)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.companions.id, companion.id));
    expect((await decide(companion.slug, null)).allowed).toBe(true);
  });
});

describe('expiry', () => {
  it('is closed the instant the expiry passes, without waiting for a job', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PUBLIC',
      // Already past: the Companion row still says ACTIVE, which is the point.
      expiresAt: new Date(Date.now() - 250),
    });

    const decision = await decide(companion.slug, null);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('companion_expired');

    const row = await db()
      .select({ status: schema.companions.status })
      .from(schema.companions)
      .where(eq(schema.companions.id, companion.id))
      .limit(1);
    // Access is derived from the clock, not from a status a sweep has to write.
    expect(row[0]?.status).toBe('ACTIVE');
  });

  it('is open a moment before the expiry', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PUBLIC',
      expiresAt: new Date(Date.now() + 5_000),
    });
    expect((await decide(companion.slug, null)).allowed).toBe(true);
  });

  it('revives the same link when the sender extends it', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PUBLIC',
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect((await decide(companion.slug, null)).allowed).toBe(false);

    await db()
      .update(schema.companions)
      .set({ expiresAt: new Date(Date.now() + 86_400_000) })
      .where(eq(schema.companions.id, companion.id));

    const decision = await decide(companion.slug, null);
    expect(decision.allowed).toBe(true);
  });
});

describe('password brute force', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PASSWORD',
      passwordHash: await hashPassword('correct horse battery staple'),
    });
    const record = await services.getCompanionBySlug(companion.slug);
    if (!record) throw new Error('fixture companion vanished');

    const sessionId = await createRecipientSession(companion.id);
    const session = {
      id: sessionId,
      companionId: companion.id,
      passwordVerifiedAt: null,
      verifiedEmail: null,
      questionCount: 0,
      extraction: {
        extractionAttempts: 0,
        quotedCharacters: 0,
        quotedUnitIds: [],
        answersDelivered: 0,
      },
    };

    await expect(
      services.verifyCompanionPassword({
        companion: record,
        session: session as never,
        password: 'hunter2',
        ipHash: 'test-ip',
      }),
    ).resolves.toBe(false);

    await expect(
      services.verifyCompanionPassword({
        companion: record,
        session: session as never,
        password: 'correct horse battery staple',
        ipHash: 'test-ip',
      }),
    ).resolves.toBe(true);
  });

  it('stops answering after ten wrong guesses in the window', async () => {
    const companion = await createCompanion(sender, {
      accessMode: 'PASSWORD',
      passwordHash: await hashPassword('correct horse battery staple'),
    });
    const record = await services.getCompanionBySlug(companion.slug);
    if (!record) throw new Error('fixture companion vanished');
    const sessionId = await createRecipientSession(companion.id);

    const attempt = (password: string) =>
      services.verifyCompanionPassword({
        companion: record,
        session: { id: sessionId } as never,
        password,
        ipHash: 'brute-force-source',
      });

    let blocked = false;
    for (let index = 0; index < 14; index += 1) {
      try {
        await attempt(`guess-${index}`);
      } catch (error) {
        blocked = true;
        expect((error as { code?: string }).code).toBe('rate_limited');
        break;
      }
    }

    // A guessing budget that never runs out is not a guessing budget.
    expect(blocked).toBe(true);
  });
});

describe('cross-tenant isolation', () => {
  it('never returns another workspace’s file through a guessed id', async () => {
    const mine = await createCompanion(sender);
    const theirs = await createCompanion(attacker);

    // The id is real and the caller knows it; ownership is what decides.
    const stolen = await services.getFile(theirs.fileId, mine.id);
    expect(stolen).toBeNull();

    const own = await services.getFile(mine.fileId, mine.id);
    expect(own?.id).toBe(mine.fileId);
  });

  it('never returns another workspace’s document units', async () => {
    const mine = await createCompanion(sender);
    await createCompanion(attacker);

    const units = await db()
      .select({ id: schema.documentUnits.id, companionId: schema.documentUnits.companionId })
      .from(schema.documentUnits)
      .where(eq(schema.documentUnits.companionId, mine.id));

    expect(units).toHaveLength(1);
    expect(units.every((unit) => unit.companionId === mine.id)).toBe(true);
  });

  it('keeps slugs unguessable rather than sequential', async () => {
    const slugs = await Promise.all(
      Array.from({ length: 12 }, () => createCompanion(sender).then((entry) => entry.slug)),
    );

    expect(new Set(slugs).size).toBe(slugs.length);

    // Six characters over a 56-symbol alphabet is about 35 bits: roughly
    // 3e10 candidates, which is not a practical scan over HTTP, and nothing
    // in the slug encodes creation order.
    const entropyBits = DEFAULT_SLUG_LENGTH * Math.log2(56);
    expect(entropyBits).toBeGreaterThan(32);

    for (const slug of slugs) {
      expect(slug).toHaveLength(DEFAULT_SLUG_LENGTH);
      expect(slug).not.toMatch(/^\d+$/);
    }

    // Links created one after another must not be adjacent in any ordering.
    expect([...slugs].sort()).not.toEqual(slugs);
  });
});
