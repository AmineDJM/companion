import { getContainer } from '../container';

/**
 * Fixed-window rate limiting.
 *
 * Backed by Redis when available so limits hold across every web instance. The
 * in-process fallback keeps development and tests working, and is explicitly
 * *not* relied upon in production (REDIS_URL is required there).
 */
export interface RateLimitInput {
  key: string;
  windowSeconds: number;
  max: number;
  /** Consume more than one unit, e.g. a heavy upload. */
  cost?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const cost = input.cost ?? 1;
  const { redis } = getContainer();

  if (redis) {
    const key = `ratelimit:${input.key}`;
    // INCRBY then conditionally EXPIRE: the first write in a window owns the TTL.
    const count = await redis.incrby(key, cost);
    if (count === cost) await redis.expire(key, input.windowSeconds);
    const ttl = await redis.ttl(key);
    return {
      allowed: count <= input.max,
      remaining: Math.max(input.max - count, 0),
      resetSeconds: ttl > 0 ? ttl : input.windowSeconds,
    };
  }

  const now = Date.now();
  const existing = memory.get(input.key);
  if (!existing || existing.resetAt <= now) {
    memory.set(input.key, { count: cost, resetAt: now + input.windowSeconds * 1000 });
    pruneMemory(now);
    return { allowed: cost <= input.max, remaining: Math.max(input.max - cost, 0), resetSeconds: input.windowSeconds };
  }
  existing.count += cost;
  return {
    allowed: existing.count <= input.max,
    remaining: Math.max(input.max - existing.count, 0),
    resetSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

function pruneMemory(now: number): void {
  if (memory.size < 5_000) return;
  for (const [key, value] of memory) {
    if (value.resetAt <= now) memory.delete(key);
  }
}

/** Test seam. */
export function resetRateLimitMemory(): void {
  memory.clear();
}
