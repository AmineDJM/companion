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

    APP_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),

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

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
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

    /** Outbound email. When unset, magic links are logged in development only. */
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('Companion <no-reply@companion.app>'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Emits the SQL Drizzle runs. Never enable in production. */
    DEBUG_SQL: booleanish.default(false),

    /** Seeds demo fixtures. Refused outside development. */
    DEMO_MODE: booleanish.default(false),
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
    if (value.NODE_ENV === 'production') {
      if (value.STORAGE_DRIVER === 'local') {
        context.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'Production requires private object storage (STORAGE_DRIVER=s3)',
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

export function appUrl(): string {
  const value = env();
  return (value.NEXT_PUBLIC_APP_URL ?? value.APP_URL).replace(/\/$/, '');
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return env().NODE_ENV === 'development';
}
