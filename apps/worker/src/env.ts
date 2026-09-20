import { z } from 'zod';

/** Worker configuration. Shares variable names with the web service. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

/**
 * An optional value that a dashboard can leave blank.
 *
 * A platform env var that exists but holds "" is a different thing from one
 * that was never set, and every schema below treats the second as "use the
 * default". A blank field is the operator saying exactly that, so it must not
 * fail `.url()` and take the whole service down at boot. S3_ENDPOINT is
 * inherited from the web service, and is empty on every AWS deployment.
 */
const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(12),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  /** Explicit public origin; see canonicalUrl(). */
  APP_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  RENDER_EXTERNAL_HOSTNAME: z.string().optional(),
  RENDER_SERVICE_NAME: z.string().optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_ANSWER_MODEL: z.string().default('gpt-5.6-luna'),
  OPENAI_VISION_MODEL: z.string().default('gpt-5.6-luna'),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: blankAsUnset(z.string().url().optional()),
  S3_FORCE_PATH_STYLE: blankAsUnset(booleanish.default(false)),

  /** Jobs processed in parallel by this worker instance. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /**
   * Reads pages with no usable embedded text using the vision model rather
   * than classical OCR. Disable only on an instance with no provider access;
   * the pages then keep whatever text was embedded, and the ingestion quality
   * metric records the shortfall instead of hiding it.
   */
  VISION_READING_ENABLED: booleanish.default(true),
  /** Pages per document that may be read with the vision model. */
  VISION_MAX_PAGES_PER_FILE: z.coerce.number().int().min(0).max(2_000).default(400),
  /**
   * Audits one page per document by transcribing its rendered image and
   * comparing that against the text the index holds, which is the only way to
   * catch a preview and an answer describing different pages. Costs one extra
   * provider call per file, so it can be turned off on a cost-sensitive
   * instance; the metric is then simply not recorded rather than assumed to pass.
   */
  PREVIEW_TEXT_AUDIT_ENABLED: booleanish.default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Temporary diagnostic escape hatch for running production against local
   * disk. A disk belongs to one instance, so a file the web service wrote is
   * not visible here: every document would upload and never process.
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
    if (
      value.NODE_ENV === 'production' &&
      value.STORAGE_DRIVER === 'local' &&
      !value.ALLOW_UNSAFE_LOCAL_STORAGE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message:
          'Production requires shared object storage (STORAGE_DRIVER=s3). The worker ' +
          'and the web service run on different instances and cannot share a disk. ' +
          'Set ALLOW_UNSAFE_LOCAL_STORAGE=true only to diagnose.',
      });
    }
  });

export type WorkerEnv = z.infer<typeof envSchema>;

let cached: WorkerEnv | null = null;

/**
 * Parses an environment without touching the cache, so a test can check a
 * configuration this process is not running under.
 */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  return parsed.data;
}

export function env(): WorkerEnv {
  if (cached) return cached;
  cached = loadWorkerEnv(process.env);
  return cached;
}

/**
 * The public origin, resolved the same way the web service resolves it.
 *
 * `APP_URL` is the explicit override; the platform's own address is used until
 * a custom domain is attached.
 */
export function canonicalUrl(source: NodeJS.ProcessEnv = process.env): string {
  // Read directly, so resolving an origin never depends on the rest of the
  // configuration having parsed. Same precedence as the web service.
  const explicit = source['APP_URL']?.trim();
  const platform = source['RENDER_EXTERNAL_URL']?.trim();
  const hostname = source['RENDER_EXTERNAL_HOSTNAME']?.trim();

  const resolved =
    explicit || platform || (hostname ? `https://${hostname}` : '') || 'http://localhost:3000';
  return resolved.replace(/\/$/, '');
}
