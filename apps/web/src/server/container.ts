import { OpenAILunaProvider, type DocumentAnswerProvider, type EmbeddingProvider } from '@companion/ai';
import { getDatabase, type Database } from '@companion/db';
import { JobDispatcher, getRedis, type Redis } from '@companion/queue';
import { createStorage, type StorageDriver } from '@companion/storage';
import { resolve } from 'node:path';
import Stripe from 'stripe';
import { canonicalUrl, env, isProduction } from './env';
import { createLogger, type Logger } from './logger';

/**
 * Process-wide service container.
 *
 * Constructed lazily and memoised so Next.js route handlers share one pool of
 * every expensive resource. Optional providers (Stripe, OpenAI, Redis) return
 * null when unconfigured; callers surface a clear operational error rather than
 * crashing the whole app at boot.
 */
export interface Container {
  db: Database;
  storage: StorageDriver;
  logger: Logger;
  redis: Redis | null;
  jobs: JobDispatcher | null;
  answerProvider: DocumentAnswerProvider | null;
  embeddingProvider: EmbeddingProvider | null;
  stripe: Stripe | null;
}

let instance: Container | null = null;

export function getContainer(): Container {
  if (instance) return instance;

  const config = env();
  const logger = createLogger(config.LOG_LEVEL, { service: 'web' });

  const db = getDatabase({
    url: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    debug: config.DEBUG_SQL && !isProduction(),
  });

  const storage = createStorage({
    driver: config.STORAGE_DRIVER,
    publicBaseUrl: canonicalUrl(),
    signingSecret: config.SESSION_SECRET,
    // Absolute so the worker, which starts from a different directory, writes
    // and reads the same objects during local development.
    localRoot: resolve(config.STORAGE_LOCAL_ROOT),
    ...(config.STORAGE_DRIVER === 's3'
      ? {
          s3: {
            bucket: config.S3_BUCKET as string,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID as string,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY as string,
            ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
            ...(config.S3_FORCE_PATH_STYLE !== undefined
              ? { forcePathStyle: config.S3_FORCE_PATH_STYLE }
              : {}),
          },
        }
      : {}),
  });

  const redis = config.REDIS_URL ? getRedis({ url: config.REDIS_URL }) : null;
  const jobs = redis ? new JobDispatcher(redis) : null;

  const openai = config.OPENAI_API_KEY
    ? new OpenAILunaProvider({
        apiKey: config.OPENAI_API_KEY,
        ...(config.OPENAI_BASE_URL ? { baseUrl: config.OPENAI_BASE_URL } : {}),
        answerModel: config.OPENAI_ANSWER_MODEL,
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        ...(config.OPENAI_ORGANIZATION ? { organization: config.OPENAI_ORGANIZATION } : {}),
      })
    : null;

  const stripe = config.STRIPE_SECRET_KEY
    ? new Stripe(config.STRIPE_SECRET_KEY, {
        // Pinned so a Stripe-side default bump cannot silently change payloads.
        apiVersion: '2026-08-26.dahlia',
        appInfo: { name: 'Companion', version: '1.0.0' },
        maxNetworkRetries: 2,
      })
    : null;

  if (!openai) logger.warn('OPENAI_API_KEY is not configured; questions will be unavailable');
  if (!stripe) logger.warn('STRIPE_SECRET_KEY is not configured; billing will be unavailable');
  if (!redis) logger.warn('REDIS_URL is not configured; document processing will run inline');

  instance = {
    db,
    storage,
    logger,
    redis,
    jobs,
    answerProvider: openai,
    embeddingProvider: openai,
    stripe,
  };
  return instance;
}

/** Test seam so integration tests can inject fakes. */
export function setContainerForTesting(value: Container | null): void {
  instance = value;
}
