import {
  AppError,
  DEFAULT_ANSWER_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  entitlementsSchema,
  platformLimitsSchema,
  type Entitlements,
  type PlanKey,
  type PlatformLimits,
} from '@companion/shared';
import { and, desc, eq, gte, schema, sql } from '@companion/db';
import { JOB_QUEUE, redisHealth, type QueueName } from '@companion/queue';
import { sql as rawSql } from '@companion/db';
import { getContainer } from '../container';
import { env } from '../env';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { invalidateLimitsCache, invalidatePlanCache } from './entitlements';
import { startOfUtcDay, startOfUtcMonth } from './admin';

/** Operational views and mutations: plans, limits, jobs, providers, health. */

export async function updatePlanEntitlements(input: {
  planKey: PlanKey;
  adminUserId: string;
  adminLabel: string;
  entitlements: Entitlements;
  display?: { displayName?: string; tagline?: string; highlights?: string[]; isPublic?: boolean };
  stripe?: { monthlyPriceId?: string | null; annualPriceId?: string | null };
}): Promise<void> {
  const { db } = getContainer();
  const parsed = entitlementsSchema.parse(input.entitlements);

  const before = await db
    .select({ entitlements: schema.plans.entitlements })
    .from(schema.plans)
    .where(eq(schema.plans.key, input.planKey))
    .limit(1);

  await db
    .update(schema.plans)
    .set({
      entitlements: parsed,
      ...(input.display?.displayName ? { displayName: input.display.displayName } : {}),
      ...(input.display?.tagline !== undefined ? { tagline: input.display.tagline } : {}),
      ...(input.display?.highlights ? { highlights: input.display.highlights } : {}),
      ...(input.display?.isPublic !== undefined ? { isPublic: input.display.isPublic } : {}),
      // Monetary prices are never mutated here: a price change needs a new
      // Stripe Price object so existing subscribers stay grandfathered.
      ...(input.stripe?.monthlyPriceId !== undefined
        ? { stripeMonthlyPriceId: input.stripe.monthlyPriceId }
        : {}),
      ...(input.stripe?.annualPriceId !== undefined
        ? { stripeAnnualPriceId: input.stripe.annualPriceId }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.plans.key, input.planKey));

  invalidatePlanCache();

  await recordAudit({
    action: AUDIT_ACTIONS.adminPlanEntitlementsChanged,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    targetType: 'plan',
    targetId: input.planKey,
    metadata: { before: before[0]?.entitlements ?? null, after: parsed },
  });
}

export async function updatePlatformLimits(input: {
  adminUserId: string;
  adminLabel: string;
  limits: PlatformLimits;
}): Promise<void> {
  const { db } = getContainer();
  const parsed = platformLimitsSchema.parse(input.limits);

  await db
    .insert(schema.platformSettings)
    .values({ id: 'singleton', limits: parsed, updatedByUserId: input.adminUserId })
    .onConflictDoUpdate({
      target: schema.platformSettings.id,
      set: { limits: parsed, updatedByUserId: input.adminUserId, updatedAt: new Date() },
    });

  invalidateLimitsCache();

  await recordAudit({
    action: AUDIT_ACTIONS.adminLimitsChanged,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    targetType: 'platform',
    targetId: 'limits',
    metadata: { limits: parsed },
  });
}

export async function setFeatureFlag(input: {
  key: string;
  adminUserId: string;
  adminLabel: string;
  description?: string;
  enabledGlobally: boolean;
  enabledPlans: PlanKey[];
  enabledWorkspaceIds: string[];
}): Promise<void> {
  const { db } = getContainer();
  await db
    .insert(schema.featureFlags)
    .values({
      key: input.key,
      description: input.description ?? null,
      enabledGlobally: input.enabledGlobally,
      enabledPlans: input.enabledPlans,
      enabledWorkspaceIds: input.enabledWorkspaceIds,
    })
    .onConflictDoUpdate({
      target: schema.featureFlags.key,
      set: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        enabledGlobally: input.enabledGlobally,
        enabledPlans: input.enabledPlans,
        enabledWorkspaceIds: input.enabledWorkspaceIds,
        updatedAt: new Date(),
      },
    });

  await recordAudit({
    action: AUDIT_ACTIONS.adminFeatureFlagChanged,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    targetType: 'feature_flag',
    targetId: input.key,
    metadata: {
      enabledGlobally: input.enabledGlobally,
      plans: input.enabledPlans,
      workspaces: input.enabledWorkspaceIds.length,
    },
  });
}

export interface JobRow {
  id: string;
  type: string;
  status: string;
  companionId: string | null;
  companionName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  fileName: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  idempotencyKey: string;
}

export async function listJobs(options: {
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: JobRow[]; total: number }> {
  const { db } = getContainer();
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;

  const conditions = [];
  if (options.status) conditions.push(eq(schema.processingJobs.status, options.status as never));
  if (options.type) conditions.push(eq(schema.processingJobs.type, options.type as never));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: schema.processingJobs.id,
        type: schema.processingJobs.type,
        status: schema.processingJobs.status,
        companionId: schema.processingJobs.companionId,
        companionName: schema.companions.name,
        workspaceId: schema.processingJobs.workspaceId,
        workspaceName: schema.workspaces.name,
        fileName: schema.files.name,
        progress: schema.processingJobs.progress,
        attempts: schema.processingJobs.attempts,
        maxAttempts: schema.processingJobs.maxAttempts,
        error: schema.processingJobs.error,
        createdAt: schema.processingJobs.createdAt,
        startedAt: schema.processingJobs.startedAt,
        finishedAt: schema.processingJobs.finishedAt,
        durationMs: schema.processingJobs.durationMs,
        idempotencyKey: schema.processingJobs.idempotencyKey,
      })
      .from(schema.processingJobs)
      .leftJoin(schema.companions, eq(schema.companions.id, schema.processingJobs.companionId))
      .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.processingJobs.workspaceId))
      .leftJoin(schema.files, eq(schema.files.id, schema.processingJobs.fileId))
      .where(where)
      .orderBy(desc(schema.processingJobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.processingJobs).where(where),
  ]);

  return { items: rows, total: totals[0]?.value ?? 0 };
}

/**
 * Retries a failed job.
 *
 * Only failed jobs are re-enqueued: re-running a completed idempotent stage
 * would repeat side effects for no benefit.
 */
export async function retryJob(input: {
  jobId: string;
  adminUserId: string;
  adminLabel: string;
}): Promise<boolean> {
  const { db, jobs } = getContainer();
  if (!jobs) throw new AppError('provider_unavailable', 'The job queue is not configured.');

  const rows = await db
    .select()
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.id, input.jobId))
    .limit(1);
  const job = rows[0];
  if (!job) throw new AppError('not_found', 'Job not found.');
  if (job.status === 'COMPLETED') {
    throw new AppError('conflict', 'This job already completed. Re-running it would duplicate work.');
  }

  const queueName: QueueName = JOB_QUEUE[job.type];
  const retried = await jobs.retryJob(queueName, job.idempotencyKey);

  if (!retried) {
    // The queue entry is gone (Redis flushed, or retention elapsed); dispatch
    // a fresh one against the same durable record.
    await jobs.enqueue({
      type: job.type,
      jobRecordId: job.id,
      workspaceId: job.workspaceId ?? '',
      companionId: job.companionId ?? '',
      idempotencyKey: job.idempotencyKey,
      ...(job.fileId ? { fileId: job.fileId } : {}),
      ...(job.fileVersionId ? { fileVersionId: job.fileVersionId } : {}),
      depth: 1,
      previousVersionId: null,
    } as never);
  }

  await db
    .update(schema.processingJobs)
    .set({ status: 'QUEUED', error: null, updatedAt: new Date() })
    .where(eq(schema.processingJobs.id, job.id));

  await recordAudit({
    action: AUDIT_ACTIONS.adminJobRetried,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: job.workspaceId,
    targetType: 'job',
    targetId: job.id,
    metadata: { type: job.type, previousStatus: job.status },
  });

  return true;
}

export interface SystemHealth {
  web: { healthy: boolean; latencyMs: number };
  database: { healthy: boolean; latencyMs: number; message?: string };
  redis: { healthy: boolean; latencyMs: number; message?: string } | null;
  storage: { healthy: boolean; latencyMs: number; message?: string };
  openai: { configured: boolean; healthy: boolean | null; latencyMs: number | null; message?: string };
  stripe: { configured: boolean; lastWebhookAt: Date | null };
  workers: {
    id: string;
    hostname: string | null;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    lastBeatAt: Date;
    alive: boolean;
  }[];
  queueBacklog: number | null;
  jobFailureRate: number;
}

/** Real probes. No mocked status, and no credential ever leaves this function. */
export async function systemHealth(options: { probeProviders?: boolean } = {}): Promise<SystemHealth> {
  const { db, redis, storage, answerProvider, jobs } = getContainer();
  const started = Date.now();

  const dbStarted = Date.now();
  let database: SystemHealth['database'];
  try {
    await db.execute(rawSql`SELECT 1`);
    database = { healthy: true, latencyMs: Date.now() - dbStarted };
  } catch (error) {
    database = {
      healthy: false,
      latencyMs: Date.now() - dbStarted,
      message: error instanceof Error ? error.name : 'unknown',
    };
  }

  const [redisStatus, storageStatus, workerRows, lastWebhook, backlog] = await Promise.all([
    redis ? redisHealth(redis) : Promise.resolve(null),
    storage.healthCheck(),
    db
      .select()
      .from(schema.workerHeartbeats)
      .orderBy(desc(schema.workerHeartbeats.lastBeatAt))
      .limit(10),
    db
      .select({ processedAt: schema.stripeEvents.createdAt })
      .from(schema.stripeEvents)
      .orderBy(desc(schema.stripeEvents.createdAt))
      .limit(1),
    jobs ? jobs.backlog().catch(() => null) : Promise.resolve(null),
  ]);

  let openai: SystemHealth['openai'] = {
    configured: Boolean(answerProvider),
    healthy: null,
    latencyMs: null,
  };
  if (answerProvider && options.probeProviders) {
    const probe = await answerProvider.health();
    openai = {
      configured: true,
      healthy: probe.healthy,
      latencyMs: probe.latencyMs,
      ...(probe.message ? { message: probe.message } : {}),
    };
  }

  const dayStart = startOfUtcDay();
  const jobStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) FILTER (WHERE status = 'FAILED')::int`,
    })
    .from(schema.processingJobs)
    .where(gte(schema.processingJobs.createdAt, dayStart));

  const total = jobStats[0]?.total ?? 0;

  return {
    web: { healthy: true, latencyMs: Date.now() - started },
    database,
    redis: redisStatus,
    storage: storageStatus,
    openai,
    stripe: {
      configured: Boolean(env().STRIPE_SECRET_KEY),
      lastWebhookAt: lastWebhook[0]?.processedAt ?? null,
    },
    workers: workerRows.map((worker) => ({
      id: worker.id,
      hostname: worker.hostname,
      activeJobs: worker.activeJobs,
      completedJobs: worker.completedJobs,
      failedJobs: worker.failedJobs,
      lastBeatAt: worker.lastBeatAt,
      // A worker that has not beaten in a minute is not processing anything.
      alive: Date.now() - worker.lastBeatAt.getTime() < 60_000,
    })),
    queueBacklog: backlog,
    jobFailureRate: total > 0 ? (jobStats[0]?.failed ?? 0) / total : 0,
  };
}

export interface ProviderStats {
  provider: string;
  answerModel: string;
  embeddingModel: string;
  requestsToday: number;
  errorsToday: number;
  errorRate: number;
  averageLatencyMs: number;
  spendTodayUsd: number;
  spendMonthUsd: number;
  cachedTokenRatio: number;
}

export async function providerStats(): Promise<ProviderStats> {
  const { db, answerProvider } = getContainer();
  const dayStart = startOfUtcDay();
  const monthStart = startOfUtcMonth();

  const [today, month] = await Promise.all([
    db
      .select({
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) FILTER (WHERE NOT ${schema.usageLedger.succeeded})::int`,
        latency: sql<number>`coalesce(avg(${schema.usageLedger.latencyMs}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'answer'), 0)::float8`,
        spend: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8`,
        inputTokens: sql<number>`coalesce(sum(${schema.usageLedger.inputTokens}), 0)::bigint`,
        cachedTokens: sql<number>`coalesce(sum(${schema.usageLedger.cachedInputTokens}), 0)::bigint`,
      })
      .from(schema.usageLedger)
      .where(gte(schema.usageLedger.occurredAt, dayStart)),
    db
      .select({ spend: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8` })
      .from(schema.usageLedger)
      .where(gte(schema.usageLedger.occurredAt, monthStart)),
  ]);

  const row = today[0];
  const requests = row?.requests ?? 0;
  const inputTokens = Number(row?.inputTokens ?? 0);

  return {
    provider: 'openai',
    answerModel: answerProvider?.answerModel ?? DEFAULT_ANSWER_MODEL,
    embeddingModel: env().OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    requestsToday: requests,
    errorsToday: row?.errors ?? 0,
    errorRate: requests > 0 ? (row?.errors ?? 0) / requests : 0,
    averageLatencyMs: Math.round(row?.latency ?? 0),
    spendTodayUsd: row?.spend ?? 0,
    spendMonthUsd: month[0]?.spend ?? 0,
    cachedTokenRatio: inputTokens > 0 ? Number(row?.cachedTokens ?? 0) / inputTokens : 0,
  };
}
