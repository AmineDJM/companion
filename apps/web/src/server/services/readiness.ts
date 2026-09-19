import { PLAN_KEYS, isFreePlan } from '@companion/shared';
import { desc, schema, sql } from '@companion/db';
import { redisHealth } from '@companion/queue';
import { getContainer } from '../container';
import { canonicalUrl, canonicalUrlSource, env, isProduction } from '../env';
import { activeSuperAdminCount, configuredSuperAdminEmails } from '../auth/super-admin';
import { emailProviderStatus } from '../email';

/**
 * Production readiness.
 *
 * Answers one question: if I point a customer at this deployment right now,
 * what breaks? Each check states what is wrong and the single next action, and
 * none of them reveals a credential — the most a reader learns is whether one
 * is present and whether it last worked.
 *
 * Deliberately separate from the quality metrics. Those measure how well the
 * product performs; these measure whether it is plugged in. A perfect recall
 * score on an instance with no object storage is not a healthy deployment.
 */
export type ReadinessStatus = 'PASS' | 'WARNING' | 'CRITICAL';

export interface ReadinessCheck {
  id: string;
  label: string;
  group: 'Infrastructure' | 'Storage' | 'AI' | 'Communication' | 'Billing' | 'Access' | 'Release';
  status: ReadinessStatus;
  /** One line of current state. Never a secret. */
  detail: string;
  /** The single next action when this is not PASS. */
  remediation?: string;
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  critical: number;
  warnings: number;
  environment: string;
  /** Short commit of the running build, when the platform provides one. */
  release: string;
  serviceName: string | null;
  generatedAt: Date;
}

const pass = (
  id: string,
  label: string,
  group: ReadinessCheck['group'],
  detail: string,
): ReadinessCheck => ({ id, label, group, status: 'PASS', detail });

const fail = (
  id: string,
  label: string,
  group: ReadinessCheck['group'],
  status: Exclude<ReadinessStatus, 'PASS'>,
  detail: string,
  remediation: string,
): ReadinessCheck => ({ id, label, group, status, detail, remediation });

export async function productionReadiness(): Promise<ReadinessReport> {
  const config = env();
  const production = isProduction();
  const checks: ReadinessCheck[] = [];

  checks.push(...(await infrastructureChecks()));
  checks.push(...(await storageChecks(production)));
  checks.push(...(await aiChecks()));
  checks.push(await emailCheck());
  checks.push(...(await billingChecks()));
  checks.push(...(await accessChecks(production)));
  checks.push(...releaseChecks());

  return {
    checks,
    passed: checks.filter((check) => check.status === 'PASS').length,
    total: checks.length,
    critical: checks.filter((check) => check.status === 'CRITICAL').length,
    warnings: checks.filter((check) => check.status === 'WARNING').length,
    environment: config.NODE_ENV,
    release: config.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
    serviceName: config.RENDER_SERVICE_NAME ?? null,
    generatedAt: new Date(),
  };
}

async function infrastructureChecks(): Promise<ReadinessCheck[]> {
  const { db, redis } = getContainer();
  const checks: ReadinessCheck[] = [];

  try {
    const started = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.push(pass('database', 'Database', 'Infrastructure', `Reachable in ${Date.now() - started}ms`));
  } catch (error) {
    checks.push(
      fail(
        'database',
        'Database',
        'Infrastructure',
        'CRITICAL',
        error instanceof Error ? error.name : 'Unreachable',
        'Check DATABASE_URL and that the database accepts connections from this service.',
      ),
    );
  }

  // pgvector is not optional: half the retrieval path does not exist without it.
  try {
    const rows = await db.execute<{ installed: number }>(sql`
      SELECT count(*)::int AS installed FROM pg_extension WHERE extname = 'vector'
    `);
    const installed = Number(rows[0]?.installed ?? 0) > 0;
    checks.push(
      installed
        ? pass('pgvector', 'pgvector extension', 'Infrastructure', 'Installed')
        : fail(
            'pgvector',
            'pgvector extension',
            'Infrastructure',
            'CRITICAL',
            'Not installed',
            'Run the migrations: the first one creates the extension. The role needs CREATE EXTENSION.',
          ),
    );
  } catch {
    checks.push(
      fail('pgvector', 'pgvector extension', 'Infrastructure', 'CRITICAL', 'Could not be checked', 'Fix database connectivity first.'),
    );
  }

  // Migration state: an un-migrated schema is the fastest way to a confusing
  // runtime error on a page nobody was looking at.
  try {
    const rows = await db.execute<{ name: string; applied: number }>(sql`
      SELECT name, count(*) OVER ()::int AS applied
      FROM schema_migrations ORDER BY name DESC LIMIT 1
    `);
    const latest = rows[0];
    checks.push(
      latest
        ? pass(
            'migrations',
            'Migrations',
            'Infrastructure',
            `${latest.applied} applied, latest ${latest.name}`,
          )
        : fail(
            'migrations',
            'Migrations',
            'Infrastructure',
            'CRITICAL',
            'None applied',
            'Run the migration step before serving traffic.',
          ),
    );
  } catch {
    checks.push(
      fail(
        'migrations',
        'Migrations',
        'Infrastructure',
        'CRITICAL',
        'schema_migrations is missing',
        'Run the migration step before serving traffic.',
      ),
    );
  }

  if (redis) {
    const health = await redisHealth(redis);
    checks.push(
      health.healthy
        ? pass('redis', 'Queue backend', 'Infrastructure', `Reachable in ${health.latencyMs}ms`)
        : fail(
            'redis',
            'Queue backend',
            'Infrastructure',
            'CRITICAL',
            health.message ?? 'Unreachable',
            'Check REDIS_URL. Without it, uploads are accepted and never processed.',
          ),
    );
  } else {
    checks.push(
      fail(
        'redis',
        'Queue backend',
        'Infrastructure',
        'CRITICAL',
        'REDIS_URL is not set',
        'Set REDIS_URL. Without it, uploads are accepted and never processed.',
      ),
    );
  }

  // Worker liveness, from the heartbeat the worker writes for itself.
  const beats = await db
    .select({
      id: schema.workerHeartbeats.id,
      lastBeatAt: schema.workerHeartbeats.lastBeatAt,
      activeJobs: schema.workerHeartbeats.activeJobs,
    })
    .from(schema.workerHeartbeats)
    .orderBy(desc(schema.workerHeartbeats.lastBeatAt))
    .limit(1);

  const beat = beats[0];
  const ageMs = beat ? Date.now() - beat.lastBeatAt.getTime() : null;
  checks.push(
    beat && ageMs !== null && ageMs < 120_000
      ? pass(
          'worker',
          'Worker heartbeat',
          'Infrastructure',
          `Last beat ${Math.round(ageMs / 1000)}s ago, ${beat.activeJobs} active`,
        )
      : fail(
          'worker',
          'Worker heartbeat',
          'Infrastructure',
          'CRITICAL',
          beat && ageMs !== null
            ? `Silent for ${Math.round(ageMs / 1000)}s`
            : 'No worker has ever checked in',
          'Start the worker service. Documents will not process without it.',
        ),
  );

  return checks;
}

async function storageChecks(production: boolean): Promise<ReadinessCheck[]> {
  const { storage } = getContainer();
  const config = env();
  const checks: ReadinessCheck[] = [];

  if (config.STORAGE_DRIVER === 'local') {
    checks.push(
      production
        ? fail(
            'storage_driver',
            'Object storage',
            'Storage',
            'CRITICAL',
            'STORAGE_DRIVER is local in production',
            'Configure an S3-compatible object store. A disk is attached to one instance, ' +
              'so the worker cannot read what the web service wrote.',
          )
        : pass('storage_driver', 'Object storage', 'Storage', 'Local disk (development)'),
    );
  } else {
    checks.push(
      pass(
        'storage_driver',
        'Object storage',
        'Storage',
        `S3-compatible${config.S3_ENDPOINT ? ' (custom endpoint)' : ''}, bucket configured`,
      ),
    );
  }

  const health = await storage.healthCheck();
  checks.push(
    health.healthy
      ? pass('storage_health', 'Storage round trip', 'Storage', `Verified in ${health.latencyMs}ms`)
      : fail(
          'storage_health',
          'Storage round trip',
          'Storage',
          'CRITICAL',
          health.message ?? 'Write or read failed',
          'Check the bucket name, credentials and that the bucket is writable.',
        ),
  );

  return checks;
}

async function aiChecks(): Promise<ReadinessCheck[]> {
  const { answerProvider, embeddingProvider } = getContainer();
  const configured = Boolean(answerProvider && embeddingProvider);

  if (!configured) {
    return [
      fail(
        'openai',
        'AI provider',
        'AI',
        'WARNING',
        'OPENAI_API_KEY is not set — answers and semantic search are unavailable',
        'Add OPENAI_API_KEY. Documents still open and index for keyword search without it.',
      ),
    ];
  }

  return [
    pass(
      'openai',
      'AI provider',
      'AI',
      `Configured — ${env().OPENAI_ANSWER_MODEL} for answers, ${env().OPENAI_EMBEDDING_MODEL} for search`,
    ),
  ];
}

/**
 * Email is optional, and sized by what actually depends on it.
 *
 * Companion does not deliver links. A sender creates a Companion, copies the
 * link and shares it wherever they like — WhatsApp, Slack, SMS, their own mail
 * client. So the core of the product (upload, attach, copy link, open, ask)
 * never sends a message, and an instance with no provider is a complete
 * instance rather than a broken one.
 *
 * Two optional features do need delivery: a magic-link sign-in, which has a
 * password alternative, and the two access modes that confirm a recipient's
 * address. Those are the only things this check weighs, and it weighs them by
 * counting the Companions that are actually configured that way — an unused
 * capability is not a deployment failure.
 */
async function emailCheck(): Promise<ReadinessCheck> {
  const { db } = getContainer();
  const status = await emailProviderStatus();

  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.companions)
    .where(sql`${schema.companions.accessMode} IN ('EMAIL_LIST', 'IDENTIFIED')
               AND ${schema.companions.deletedAt} IS NULL`);
  const dependents = Number(rows[0]?.value ?? 0);

  if (!status.configured) {
    return dependents === 0
      ? pass(
          'email',
          'Email delivery (optional)',
          'Communication',
          'Not configured, and nothing needs it — links are shared by the sender',
        )
      : {
          id: 'email',
          label: 'Email delivery (optional)',
          group: 'Communication',
          status: 'WARNING',
          detail: `Not configured, but ${dependents} Companion(s) confirm a recipient's address`,
          remediation:
            'Those recipients cannot receive their code. Either set EMAIL_PROVIDER, or switch ' +
            'those Companions to a public or password-protected link.',
        };
  }

  if (status.attempts24h === 0) {
    return pass(
      'email',
      'Email delivery (optional)',
      'Communication',
      `${status.displayName} configured, nothing sent in 24h`,
    );
  }

  if (status.errorRate24h > 0.2) {
    const detail =
      `${status.displayName}: ${status.failures24h} of ${status.attempts24h} failed in 24h` +
      (status.lastError ? ` (${status.lastError})` : '');
    // Only critical when someone is locked out right now: a configured but
    // failing provider that nothing depends on is worth fixing, not blocking.
    return dependents > 0
      ? fail(
          'email',
          'Email delivery (optional)',
          'Communication',
          'CRITICAL',
          `${detail} — ${dependents} Companion(s) depend on it`,
          'Check the sending domain is verified with the provider.',
        )
      : {
          id: 'email',
          label: 'Email delivery (optional)',
          group: 'Communication',
          status: 'WARNING',
          detail,
          remediation: 'Check the sending domain is verified with the provider.',
        };
  }

  return pass(
    'email',
    'Email delivery (optional)',
    'Communication',
    `${status.displayName}, last success ${status.lastSuccessAt ? status.lastSuccessAt.toISOString() : 'never'}`,
  );
}

async function billingChecks(): Promise<ReadinessCheck[]> {
  const { db, stripe } = getContainer();
  const config = env();
  const checks: ReadinessCheck[] = [];

  if (!stripe) {
    // Billing removes itself from the product while Stripe is unset: /pricing
    // and /billing do not exist and nothing links to them, so there is no
    // broken path for a customer to find. Reporting that as a warning would
    // put a permanent yellow row on this page for a deliberate decision.
    //
    // It stops being deliberate the moment money is already involved. A live
    // subscription means someone bought something this instance can no longer
    // renew, change or cancel, and whose webhooks are being discarded. A
    // cancelled or incomplete one is history, and history needs no provider.
    const rows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.subscriptions)
      .where(
        sql`${schema.subscriptions.status} IN ('active', 'trialing', 'past_due', 'unpaid', 'paused')`,
      );
    const dependents = Number(rows[0]?.value ?? 0);

    return [
      dependents === 0
        ? pass(
            'stripe',
            'Billing (optional)',
            'Billing',
            'Not configured — the product runs with no billing and hides every path to it',
          )
        : fail(
            'stripe',
            'Billing (optional)',
            'Billing',
            'CRITICAL',
            `Not configured, but ${dependents} subscription(s) exist`,
            'Restore STRIPE_SECRET_KEY. Until it is set, those subscriptions cannot be ' +
              'renewed, changed or cancelled, and their webhooks are being discarded.',
          ),
    ];
  }

  checks.push(pass('stripe', 'Stripe secret key', 'Billing', 'Configured'));

  checks.push(
    config.STRIPE_WEBHOOK_SECRET
      ? pass('stripe_webhook_secret', 'Stripe webhook secret', 'Billing', 'Configured')
      : fail(
          'stripe_webhook_secret',
          'Stripe webhook secret',
          'Billing',
          'CRITICAL',
          'Not set — every Stripe event is rejected, so subscriptions never activate',
          `Add an endpoint at ${canonicalUrl()}/api/stripe/webhook and set STRIPE_WEBHOOK_SECRET.`,
        ),
  );

  // Price ids live in the database so an operator can change them without a
  // deploy; a plan missing one cannot be bought.
  const plans = await db
    .select({
      key: schema.plans.key,
      monthly: schema.plans.stripeMonthlyPriceId,
      annual: schema.plans.stripeAnnualPriceId,
    })
    .from(schema.plans);

  for (const key of PLAN_KEYS) {
    if (isFreePlan(key)) continue;
    const plan = plans.find((entry) => entry.key === key);
    const missing = [
      plan?.monthly ? null : 'monthly',
      plan?.annual ? null : 'annual',
    ].filter(Boolean);

    checks.push(
      missing.length === 0
        ? pass(`stripe_price_${key}`, `${key} price ids`, 'Billing', 'Complete')
        : fail(
            `stripe_price_${key}`,
            `${key} price ids`,
            'Billing',
            'WARNING',
            `Missing ${missing.join(' and ')}`,
            `Create the price in Stripe, then set it on /admin/plans or via STRIPE_PRICE_${key.toUpperCase()}_MONTHLY and _ANNUAL before seeding.`,
          ),
    );
  }

  const events = await db
    .select({ createdAt: schema.stripeEvents.createdAt })
    .from(schema.stripeEvents)
    .orderBy(desc(schema.stripeEvents.createdAt))
    .limit(1);

  checks.push(
    events[0]
      ? pass(
          'stripe_webhook_traffic',
          'Stripe webhook traffic',
          'Billing',
          `Last event ${events[0].createdAt.toISOString()}`,
        )
      : {
          id: 'stripe_webhook_traffic',
          label: 'Stripe webhook traffic',
          group: 'Billing',
          status: 'WARNING',
          detail: 'No event has ever arrived',
          remediation: 'Send a test event from the Stripe dashboard to confirm the endpoint.',
        },
  );

  return checks;
}

async function accessChecks(production: boolean): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const configured = configuredSuperAdminEmails();
  const active = await activeSuperAdminCount();

  checks.push(
    active > 0
      ? pass(
          'super_admin',
          'Super Admin access',
          'Access',
          `${active} account(s) can reach /admin`,
        )
      : fail(
          'super_admin',
          'Super Admin access',
          'Access',
          'CRITICAL',
          configured.length === 0
            ? 'SUPER_ADMIN_EMAILS is not set and nobody holds the role'
            : `${configured.length} address(es) listed, none has registered yet`,
          configured.length === 0
            ? 'Set SUPER_ADMIN_EMAILS, then run: pnpm admin:bootstrap'
            : 'Register with a listed address, or run: pnpm admin:bootstrap',
        ),
  );

  const source = canonicalUrlSource();
  const origin = canonicalUrl();
  const localhost = origin.includes('localhost') || origin.includes('127.0.0.1');

  checks.push(
    source === 'APP_URL'
      ? pass('canonical_url', 'Canonical URL', 'Access', `${origin} (APP_URL)`)
      : source === 'RENDER_EXTERNAL_URL'
        ? {
            id: 'canonical_url',
            label: 'Canonical URL',
            group: 'Access',
            status: 'WARNING',
            detail: `${origin} (from the platform)`,
            remediation:
              'Set APP_URL once a custom domain is attached; share links and OAuth callbacks use this origin.',
          }
        : fail(
            'canonical_url',
            'Canonical URL',
            'Access',
            production ? 'CRITICAL' : 'WARNING',
            `${origin} (development fallback)`,
            'Set APP_URL. Share links and email links would point at localhost.',
          ),
  );

  if (production && localhost) {
    checks.push(
      fail(
        'public_url',
        'Public reachability',
        'Access',
        'CRITICAL',
        'The canonical origin is a loopback address',
        'Set APP_URL to the address recipients actually use.',
      ),
    );
  } else {
    checks.push(pass('public_url', 'Public reachability', 'Access', `Links are built from ${origin}`));
  }

  return checks;
}

function releaseChecks(): ReadinessCheck[] {
  const config = env();
  const checks: ReadinessCheck[] = [];

  checks.push(
    config.RENDER_GIT_COMMIT
      ? pass('release', 'Build version', 'Release', config.RENDER_GIT_COMMIT.slice(0, 7))
      : {
          id: 'release',
          label: 'Build version',
          group: 'Release',
          status: 'WARNING',
          detail: 'Not reported by the platform',
          remediation: 'Expected outside Render; quality evidence is attributed to "dev".',
        },
  );

  if (isProduction()) {
    checks.push(
      config.ALLOW_UNSAFE_LOCAL_STORAGE
        ? fail(
            'unsafe_flags',
            'Diagnostic flags',
            'Release',
            'CRITICAL',
            'ALLOW_UNSAFE_LOCAL_STORAGE is enabled',
            'Remove it. It exists to diagnose, never to run.',
          )
        : pass('unsafe_flags', 'Diagnostic flags', 'Release', 'None enabled'),
    );
    checks.push(
      config.DEBUG_SQL
        ? fail('debug_sql', 'SQL logging', 'Release', 'WARNING', 'DEBUG_SQL is enabled', 'Disable it: every query is written to the log.')
        : pass('debug_sql', 'SQL logging', 'Release', 'Disabled'),
    );
  }

  return checks;
}

/**
 * Document conversion, reported from the worker's own heartbeat rather than
 * probed here: LibreOffice and Poppler live in the worker image, and the web
 * service cannot see them.
 */
export async function conversionToolingCheck(): Promise<ReadinessCheck> {
  const { db } = getContainer();
  const rows = await db
    .select({ version: schema.workerHeartbeats.version })
    .from(schema.workerHeartbeats)
    .orderBy(desc(schema.workerHeartbeats.lastBeatAt))
    .limit(1);

  const version = rows[0]?.version ?? null;
  if (!version) {
    return fail(
      'conversion',
      'Document conversion',
      'Infrastructure',
      'WARNING',
      'No worker has reported its tooling',
      'Start the worker; it reports LibreOffice and Poppler availability on each beat.',
    );
  }

  const hasLibreOffice = version.includes('soffice');
  const hasPoppler = version.includes('poppler');
  const missing = [
    hasLibreOffice ? null : 'LibreOffice',
    hasPoppler ? null : 'Poppler',
  ].filter(Boolean);

  return missing.length === 0
    ? pass('conversion', 'Document conversion', 'Infrastructure', 'LibreOffice and Poppler available')
    : fail(
        'conversion',
        'Document conversion',
        'Infrastructure',
        'CRITICAL',
        `${missing.join(' and ')} missing on the worker`,
        'Office files cannot be converted and PDFs cannot be rendered to page images. Rebuild the worker image.',
      );
}

