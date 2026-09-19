import {
  DEFAULT_PLATFORM_LIMITS,
  PLAN_DEFINITIONS,
  PLAN_KEYS,
  listPlans,
} from '@companion/shared';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, type Database } from './client.js';
import { featureFlags, plans, platformSettings, usagePacks, users } from './schema.js';

/**
 * Idempotent bootstrap of configuration rows.
 *
 * Runs on every deploy. It creates plans, platform limits, feature flags and
 * question packs if missing, and promotes the accounts listed in
 * SUPER_ADMIN_EMAILS. It never touches customer data and never seeds fake
 * metrics — production dashboards start at real zeros.
 */
export async function seedConfiguration(db: Database): Promise<void> {
  for (const definition of listPlans()) {
    const existing = await db.select().from(plans).where(eq(plans.key, definition.key)).limit(1);
    if (existing.length === 0) {
      await db.insert(plans).values({
        key: definition.key,
        displayName: definition.displayName,
        tagline: definition.tagline,
        monthlyPriceCents: definition.monthlyPriceCents,
        annualPriceCents: definition.annualPriceCents,
        currency: definition.currency,
        entitlements: definition.entitlements,
        highlights: definition.highlights,
        sortOrder: definition.sortOrder,
        isPublic: true,
        stripeMonthlyPriceId: stripePriceEnv(definition.key, 'MONTHLY'),
        stripeAnnualPriceId: stripePriceEnv(definition.key, 'ANNUAL'),
      });
    } else {
      // Keep Stripe price ids in sync with the environment without ever
      // overwriting entitlements an operator edited in /admin.
      const monthly = stripePriceEnv(definition.key, 'MONTHLY');
      const annual = stripePriceEnv(definition.key, 'ANNUAL');
      if (monthly || annual) {
        await db
          .update(plans)
          .set({
            ...(monthly ? { stripeMonthlyPriceId: monthly } : {}),
            ...(annual ? { stripeAnnualPriceId: annual } : {}),
            updatedAt: new Date(),
          })
          .where(eq(plans.key, definition.key));
      }
    }
  }

  const settings = await db.select().from(platformSettings).limit(1);
  if (settings.length === 0) {
    await db.insert(platformSettings).values({ id: 'singleton', limits: DEFAULT_PLATFORM_LIMITS });
  }

  const defaultFlags = [
    { key: 'identified_access', description: 'Require recipients to confirm an email address.' },
    { key: 'custom_domains', description: 'Serve Companions from a customer-owned hostname.' },
    { key: 'advanced_analytics', description: 'Per-page dwell time and unanswered-topic insight.' },
    { key: 'team_workspaces', description: 'Invite colleagues into a shared workspace.' },
    { key: 'new_retrieval_pipeline', description: 'Experimental retrieval ranking.' },
    { key: 'question_packs', description: 'Allow purchasing additional question packs.' },
  ];
  for (const flag of defaultFlags) {
    await db.insert(featureFlags).values({ ...flag, enabledGlobally: false }).onConflictDoNothing();
  }

  const defaultPacks = [
    { key: 'pack_500', displayName: '500 questions', questions: 500, priceCents: 900, sortOrder: 0 },
    {
      key: 'pack_2500',
      displayName: '2,500 questions',
      questions: 2_500,
      priceCents: 3_900,
      sortOrder: 1,
    },
    {
      key: 'pack_10000',
      displayName: '10,000 questions',
      questions: 10_000,
      priceCents: 12_900,
      sortOrder: 2,
    },
  ];
  for (const pack of defaultPacks) {
    await db
      .insert(usagePacks)
      .values({ ...pack, currency: 'eur', isActive: true })
      .onConflictDoNothing();
  }
}

function stripePriceEnv(planKey: string, interval: 'MONTHLY' | 'ANNUAL'): string | null {
  if (planKey === 'free') return null;
  return process.env[`STRIPE_PRICE_${planKey.toUpperCase()}_${interval}`] ?? null;
}

/**
 * Promotes the accounts named in SUPER_ADMIN_EMAILS. This is the only
 * bootstrap path to the admin role — privilege is never inferred from an email
 * domain at request time.
 */
export async function syncSuperAdmins(db: Database, emails: string[]): Promise<number> {
  if (emails.length === 0) return 0;
  const normalized = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return 0;
  const result = await db
    .update(users)
    .set({ platformRole: 'super_admin', updatedAt: new Date() })
    .where(sql`lower(${users.email}) = ANY(${normalized})`)
    .returning({ id: users.id });
  return result.length;
}

export function parseSuperAdminEmails(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'));
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const { db, sql: client } = createDatabase({ url, max: 2 });
  seedConfiguration(db)
    .then(async () => {
      const promoted = await syncSuperAdmins(db, parseSuperAdminEmails(process.env.SUPER_ADMIN_EMAILS));
      process.stdout.write(
        `configuration seeded (${PLAN_KEYS.length} plans, ${promoted} super admin(s) synced)\n`,
      );
      await client.end({ timeout: 5 });
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`seed failed: ${(error as Error).message}\n`);
      await client.end({ timeout: 5 });
      process.exit(1);
    });
}

export { PLAN_DEFINITIONS };
