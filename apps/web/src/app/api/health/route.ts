import { NextResponse } from 'next/server';
import { sql } from '@companion/db';
import { redisHealth } from '@companion/queue';
import { getContainer } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Render's health check calls this. A plain 200 means the process is up; the
 * body reports each dependency so a degraded deploy is visible without opening
 * the admin console. Nothing here leaks a credential or a connection string.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const started = Date.now();
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const { db, redis, storage } = getContainer();

  const checks: Record<string, { healthy: boolean; latencyMs: number; message?: string }> = {};

  try {
    const dbStarted = Date.now();
    await db.execute(sql`SELECT 1`);
    checks['database'] = { healthy: true, latencyMs: Date.now() - dbStarted };
  } catch (error) {
    checks['database'] = {
      healthy: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.name : 'unknown',
    };
  }

  if (redis) {
    checks['redis'] = await redisHealth(redis);
  }

  if (deep) {
    checks['storage'] = await storage.healthCheck();
  }

  const healthy = Object.values(checks).every((check) => check.healthy);

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env['RENDER_GIT_COMMIT']?.slice(0, 7) ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      checks,
    },
    {
      // A degraded dependency still returns 200 so Render does not cycle the
      // service during a transient database blip; /admin/system shows the truth.
      status: 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
