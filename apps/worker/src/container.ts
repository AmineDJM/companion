import {
  OpenAILunaProvider,
  OpenAIVisionReader,
  type DocumentVisionProvider,
  type EmbeddingProvider,
} from '@companion/ai';
import { getDatabase, type Database } from '@companion/db';
import { JobDispatcher, getRedis, type Redis } from '@companion/queue';
import { resolve } from 'node:path';
import { createStorage, type StorageDriver } from '@companion/storage';
import { env } from './env.js';
import { createLogger, type Logger } from './logger.js';

export interface WorkerContainer {
  db: Database;
  storage: StorageDriver;
  redis: Redis;
  jobs: JobDispatcher;
  embeddings: EmbeddingProvider | null;
  /** Reads pages that have no usable embedded text. Replaces classical OCR. */
  vision: DocumentVisionProvider | null;
  logger: Logger;
}

let instance: WorkerContainer | null = null;

export function container(): WorkerContainer {
  if (instance) return instance;
  const config = env();
  const logger = createLogger(config.LOG_LEVEL, { service: 'worker' });

  const db = getDatabase({ url: config.DATABASE_URL, max: config.DATABASE_POOL_MAX });
  const redis = getRedis({ url: config.REDIS_URL });

  const storage = createStorage({
    driver: config.STORAGE_DRIVER,
    publicBaseUrl: config.APP_URL,
    signingSecret: config.SESSION_SECRET,
    localRoot: resolve(config.STORAGE_LOCAL_ROOT),
    ...(config.STORAGE_DRIVER === 's3'
      ? {
          s3: {
            bucket: config.S3_BUCKET as string,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID as string,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY as string,
            ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
          },
        }
      : {}),
  });

  const embeddings = config.OPENAI_API_KEY
    ? new OpenAILunaProvider({
        apiKey: config.OPENAI_API_KEY,
        ...(config.OPENAI_BASE_URL ? { baseUrl: config.OPENAI_BASE_URL } : {}),
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        answerModel: config.OPENAI_ANSWER_MODEL,
      })
    : null;

  const vision =
    config.OPENAI_API_KEY && config.VISION_READING_ENABLED
      ? new OpenAIVisionReader({
          apiKey: config.OPENAI_API_KEY,
          ...(config.OPENAI_BASE_URL ? { baseUrl: config.OPENAI_BASE_URL } : {}),
          answerModel: config.OPENAI_ANSWER_MODEL,
          visionModel: config.OPENAI_VISION_MODEL,
        })
      : null;

  if (!embeddings) {
    logger.warn('OPENAI_API_KEY is not set; documents will be indexed for keyword search only');
  }
  if (!vision) {
    logger.warn('page reading is disabled; scanned pages will not be indexed');
  }

  instance = { db, storage, redis, jobs: new JobDispatcher(redis), embeddings, vision, logger };
  return instance;
}
