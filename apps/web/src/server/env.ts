import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Parsed once, server-side only. Nothing in this module may be imported from a
 * client component — every secret lives here and nowhere else.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /**
     * Explicit public origin. Set it once a custom domain is attached; until
     * then the platform's own URL is used. See `canonicalUrl()`.
     */
    APP_URL: z.string().url().optional(),
    /** Set by Render on a web service, e.g. https://companion-web.onrender.com */
    RENDER_EXTERNAL_URL: z.string().url().optional(),
    RENDER_EXTERNAL_HOSTNAME: z.string().optional(),
    /** Set by Render on every service; used to report deployment consistency. */
    RENDER_SERVICE_NAME: z.string().optional(),
    RENDER_GIT_COMMIT: z.string().optional(),
    RENDER_INSTANCE_ID: z.string().optional(),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    REDIS_URL: z.string().min(1).optional(),

    /** Signs session cookies, recipient tokens and local storage URLs. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_ANSWER_MODEL: z.string().default('gpt-5.6-luna'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    OPENAI_ORGANIZATION: z.string().optional(),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().default('.storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: booleanish.default(false),

    /**
     * Checkout and the portal are server-side redirects, so no publishable key
     * is needed and none is accepted: a key the browser never uses is a
     * deployment step that can only be got wrong.
     */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_PERSONAL_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PERSONAL_ANNUAL: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_ANNUAL: z.string().optional(),
    STRIPE_PRICE_BUSINESS_MONTHLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_ANNUAL: z.string().optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    /** Comma-separated. The only bootstrap path to the super-admin role. */
    SUPER_ADMIN_EMAILS: z.string().optional(),

    /**
     * Outbound email. `none` is explicit rather than implied by missing
     * credentials, so a production instance cannot lose verification codes
     * because a variable was forgotten.
     */
    EMAIL_PROVIDER: z.enum(['resend', 'smtp', 'none']).default('none'),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('Companion <no-reply@companion.app>'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Emits the SQL Drizzle runs. Never enable in production. */
    DEBUG_SQL: booleanish.default(false),

    /** Seeds demo fixtures. Refused outside development. */
    DEMO_MODE: booleanish.default(false),

    /**
     * Temporary diagnostic escape hatch for running production against local
     * disk. A disk belongs to one instance, so the worker and the web service
     * cannot see each other's files: documents upload and never process.
     * Never leave this on.
     */
    ALLOW_UNSAFE_LOCAL_STORAGE: booleanish.default(false),
  })
  .superRefine((value, context) => {
    if (value.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!value[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      });
    }
    if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_URL) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'SMTP_URL is required when EMAIL_PROVIDER=smtp',
      });
    }
    if (value.NODE_ENV === 'production') {
      if (value.STORAGE_DRIVER === 'local' && !value.ALLOW_UNSAFE_LOCAL_STORAGE) {
        context.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message:
            'Production requires shared object storage (STORAGE_DRIVER=s3). A disk is ' +
            'attached to a single instance, so the worker cannot read what the web ' +
            'service wrote. Set ALLOW_UNSAFE_LOCAL_STORAGE=true only to diagnose.',
        });
      }
      if (!value.REDIS_URL) {
        context.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required in production for durable background jobs',
        });
      }
      if (value.DEMO_MODE) {
        context.addIssue({
          code: 'custom',
          path: ['DEMO_MODE'],
          message: 'DEMO_MODE must never be enabled in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test seam: lets integration tests install a configuration explicitly. */
export function setEnvForTesting(value: Env | null): void {
  cached = value;
}

/**
 * The one place a public URL is decided.
 *
 * `APP_URL` is the explicit production override — the custom domain, once one
 * is attached. Until then the platform's own address is correct and already
 * known, so a first deploy does not need a variable filled in to produce
 * working share links. The development fallback is last.
 *
 * Every server-generated URL goes through here: share links, Stripe success
 * and cancel URLs, email links, OAuth callbacks and page metadata. Nothing
 * builds an origin of its own.
 */
export function canonicalUrl(source: NodeJS.ProcessEnv = process.env): string {
  // Read directly rather than through env(): an origin is not a secret, and
  // page metadata is generated during the build, where the secrets that env()
  // insists on are not necessarily present. Coupling the two would make the
  // build fail for want of a session key it never uses.
  const explicit = source['APP_URL']?.trim();
  const platform = source['RENDER_EXTERNAL_URL']?.trim();
  const hostname = source['RENDER_EXTERNAL_HOSTNAME']?.trim();

  const resolved =
    explicit || platform || (hostname ? `https://${hostname}` : '') || 'http://localhost:3000';
  return resolved.replace(/\/$/, '');
}

/** Where the canonical origin came from, for the readiness report. */
export function canonicalUrlSource(
  source: NodeJS.ProcessEnv = process.env,
): 'APP_URL' | 'RENDER_EXTERNAL_URL' | 'fallback' {
  if (source['APP_URL']?.trim()) return 'APP_URL';
  if (source['RENDER_EXTERNAL_URL']?.trim() || source['RENDER_EXTERNAL_HOSTNAME']?.trim()) {
    return 'RENDER_EXTERNAL_URL';
  }
  return 'fallback';
}


export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return env().NODE_ENV === 'development';
}
