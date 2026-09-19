import { Redis, type RedisOptions } from 'ioredis';

export interface RedisConfig {
  url: string;
  /** BullMQ requires this to be null so blocking commands are never aborted. */
  maxRetriesPerRequest?: null;
  keyPrefix?: string;
}

let shared: Redis | null = null;

function optionsFor(config: RedisConfig): RedisOptions {
  const isTls = config.url.startsWith('rediss://');
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Render's Key Value service terminates TLS with its own certificate chain.
    ...(isTls ? { tls: {} } : {}),
    ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  };
}

export function createRedis(config: RedisConfig): Redis {
  return new Redis(config.url, optionsFor(config));
}

/** One connection shared by all queues in a process. */
export function getRedis(config: RedisConfig): Redis {
  if (!shared) shared = createRedis(config);
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (!shared) return;
  await shared.quit();
  shared = null;
}

export async function redisHealth(
  redis: Redis,
): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
  const started = Date.now();
  try {
    const reply = await redis.ping();
    return { healthy: reply === 'PONG', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.name : 'unknown error',
    };
  }
}
