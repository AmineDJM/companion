import { z } from 'zod';

/** Worker configuration. Shares variable names with the web service. */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(12),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url().default('http://localhost:3000'),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_ANSWER_MODEL: z.string().default('gpt-5.6-luna'),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(false),

  /** Jobs processed in parallel by this worker instance. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Languages passed to OCR, e.g. "eng+fra". */
  OCR_LANGUAGES: z.string().default('eng'),
  /** Set false to skip OCR entirely on constrained instances. */
  OCR_ENABLED: booleanish.default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type WorkerEnv = z.infer<typeof envSchema>;

let cached: WorkerEnv | null = null;

export function env(): WorkerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
