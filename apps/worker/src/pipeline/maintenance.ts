import { and, eq, isNull, lte, schema, sql } from '@companion/db';
import { measure } from '../lib/quality.js';
import { container } from '../container.js';
import { runBillingIntegrity } from './billing-integrity.js';
import { runStorageIntegritySweep } from './integrity.js';

/**
 * Periodic housekeeping.
 *
 * Small, idempotent tasks that keep the system honest: expiring links, freeing
 * storage, clearing dead sessions and refreshing the analytics rollups the
 * admin dashboards read.
 */
export async function runMaintenance(): Promise<void> {
  await Promise.allSettled([
    expireCompanions(),
    reclaimStorage(),
    purgeExpiredSessions(),
    purgeExpiredDrafts(),
    refreshDailyRollups(),
    runStorageIntegritySweep(),
    recordJobReliability(),
    recordLatencyPercentiles(),
    recordAnalyticsIntegrity(),
    runBillingIntegrity(),
    recordViewerVitals(),
  ]);
}

/** Flips Companions whose expiry has passed so list views read correctly. */
async function expireCompanions(): Promise<void> {
  const { db } = container();
  await db
    .update(schema.companions)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(
      and(
        eq(schema.companions.status, 'ACTIVE'),
        sql`${schema.companions.expiresAt} IS NOT NULL`,
        sql`${schema.companions.expiresAt} <= now()`,
      ),
    );
}

/** Deletes storage objects whose retention window has elapsed. */
async function reclaimStorage(): Promise<void> {
  const { db, storage, logger } = container();
  const pending = await db
    .select()
    .from(schema.storageReclamations)
    .where(
      and(
        isNull(schema.storageReclamations.deletedAt),
        lte(schema.storageReclamations.deleteAfterAt, new Date()),
      ),
    )
    .limit(500);

  for (const row of pending) {
    try {
      await storage.delete(row.storageKey);
      await db
        .update(schema.storageReclamations)
        .set({ deletedAt: new Date(), error: null })
        .where(eq(schema.storageReclamations.id, row.id));
    } catch (error) {
      // Retried on the next pass; the row is never dropped silently.
      await db
        .update(schema.storageReclamations)
        .set({ error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' })
        .where(eq(schema.storageReclamations.id, row.id));
      logger.warn('storage reclamation failed', { key: row.storageKey });
    }
  }
}

async function purgeExpiredSessions(): Promise<void> {
  const { db } = container();
  await db
    .delete(schema.recipientSessions)
    .where(sql`${schema.recipientSessions.expiresAt} < now() - interval '30 days'`);
  await db
    .delete(schema.authSessions)
    .where(sql`${schema.authSessions.expiresAt} < now() - interval '7 days'`);
  await db.delete(schema.authTokens).where(sql`${schema.authTokens.expiresAt} < now() - interval '7 days'`);
}

async function purgeExpiredDrafts(): Promise<void> {
  const { db, storage } = container();
  const expired = await db
    .select()
    .from(schema.uploadDrafts)
    .where(and(isNull(schema.uploadDrafts.claimedAt), sql`${schema.uploadDrafts.expiresAt} <= now()`))
    .limit(100);

  for (const draft of expired) {
    await storage
      .deleteMany(draft.items.map((item) => item.storageKey))
      .catch(() => undefined);
    await db.delete(schema.uploadDrafts).where(eq(schema.uploadDrafts.id, draft.id));
  }
}

/**
 * Rolls the usage ledger up per day and workspace so /admin dashboards stay
 * fast as the ledger grows into millions of rows.
 */
async function refreshDailyRollups(): Promise<void> {
  const { db } = container();
  await db.execute(sql`
    INSERT INTO usage_daily_rollups (
      day, workspace_id, questions, answers, input_tokens, cached_input_tokens,
      output_tokens, answer_cost_usd, embedding_cost_usd, total_cost_usd, updated_at
    )
    SELECT
      to_char(occurred_at, 'YYYY-MM-DD') AS day,
      workspace_id,
      count(*) FILTER (WHERE billable)::int,
      count(*) FILTER (WHERE request_kind = 'answer' AND succeeded)::int,
      coalesce(sum(input_tokens), 0),
      coalesce(sum(cached_input_tokens), 0),
      coalesce(sum(output_tokens), 0),
      coalesce(sum(estimated_cost_usd) FILTER (WHERE request_kind = 'answer'), 0),
      coalesce(sum(estimated_cost_usd) FILTER (WHERE request_kind = 'embedding'), 0),
      coalesce(sum(estimated_cost_usd), 0),
      now()
    FROM usage_ledger
    WHERE occurred_at >= now() - interval '3 days'
      AND workspace_id IS NOT NULL
    GROUP BY 1, 2
    ON CONFLICT (day, workspace_id) DO UPDATE SET
      questions = EXCLUDED.questions,
      answers = EXCLUDED.answers,
      input_tokens = EXCLUDED.input_tokens,
      cached_input_tokens = EXCLUDED.cached_input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      answer_cost_usd = EXCLUDED.answer_cost_usd,
      embedding_cost_usd = EXCLUDED.embedding_cost_usd,
      total_cost_usd = EXCLUDED.total_cost_usd,
      updated_at = now()
  `);
}

/**
 * Background job reliability.
 *
 * Measured from the job records rather than from the queue, because the record
 * is what survives a worker restart. A job that has been RUNNING far longer
 * than any real document takes is stuck, and a stuck job is a Companion that
 * never becomes readable — a silent failure no HTTP status would reveal.
 */
async function recordJobReliability(): Promise<void> {
  const { db } = container();

  const window = await db
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) FILTER (WHERE ${schema.processingJobs.status} IN ('COMPLETED', 'SKIPPED'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${schema.processingJobs.status} = 'FAILED')::int`,
      p95DurationMs: sql<number>`coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${schema.processingJobs.durationMs}), 0)::int`,
    })
    .from(schema.processingJobs)
    .where(sql`${schema.processingJobs.createdAt} >= now() - interval '24 hours'`);

  const terminal = (window[0]?.succeeded ?? 0) + (window[0]?.failed ?? 0);
  if (terminal > 0) {
    await measure('performance.job_success_rate', {
      value: (window[0]?.succeeded ?? 0) / terminal,
      sampleSize: terminal,
      evidence: {
        windowHours: 24,
        totalJobs: window[0]?.total ?? 0,
        failedJobs: window[0]?.failed ?? 0,
        p95DurationMs: window[0]?.p95DurationMs ?? 0,
      },
    });
  }

  const stuck = await db
    .select({
      value: sql<number>`count(*)::int`,
      types: sql<string[]>`coalesce(array_agg(DISTINCT ${schema.processingJobs.type}), ARRAY[]::text[])`,
    })
    .from(schema.processingJobs)
    .where(
      and(
        eq(schema.processingJobs.status, 'RUNNING'),
        sql`${schema.processingJobs.startedAt} < now() - interval '30 minutes'`,
      ),
    );

  await measure('performance.stuck_jobs', {
    value: stuck[0]?.value ?? 0,
    evidence: { thresholdMinutes: 30, jobTypes: stuck[0]?.types ?? [] },
  });

  const live = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.workerHeartbeats)
    .where(sql`${schema.workerHeartbeats.lastBeatAt} >= now() - interval '2 minutes'`);

  await measure('performance.worker_liveness', {
    value: (live[0]?.value ?? 0) > 0 ? 1 : 0,
    evidence: { liveWorkers: live[0]?.value ?? 0, staleAfterSeconds: 120 },
  });
}

/**
 * Served latency.
 *
 * Percentiles over the last day, computed in the database from the rows the
 * request path already wrote. Retrieval and answering are reported separately
 * because they fail for different reasons: a slow index is a schema problem,
 * a slow model is a provider or prompt-size problem.
 */
async function recordLatencyPercentiles(): Promise<void> {
  const { db } = container();

  const retrieval = await db
    .select({
      p95: sql<number>`coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${schema.retrievalDiagnostics.latencyMs}), 0)::int`,
      p50: sql<number>`coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY ${schema.retrievalDiagnostics.latencyMs}), 0)::int`,
      samples: sql<number>`count(*)::int`,
    })
    .from(schema.retrievalDiagnostics)
    .where(sql`${schema.retrievalDiagnostics.createdAt} >= now() - interval '24 hours'`);

  if ((retrieval[0]?.samples ?? 0) > 0) {
    await measure('performance.retrieval_latency_p95_ms', {
      value: retrieval[0]?.p95 ?? 0,
      sampleSize: retrieval[0]?.samples ?? 0,
      evidence: { windowHours: 24, p50Ms: retrieval[0]?.p50 ?? 0 },
    });
  }

  const answers = await db
    .select({
      p95: sql<number>`coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${schema.usageLedger.latencyMs}), 0)::int`,
      p50: sql<number>`coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY ${schema.usageLedger.latencyMs}), 0)::int`,
      samples: sql<number>`count(*)::int`,
    })
    .from(schema.usageLedger)
    .where(
      and(
        eq(schema.usageLedger.requestKind, 'answer'),
        eq(schema.usageLedger.succeeded, true),
        sql`${schema.usageLedger.occurredAt} >= now() - interval '24 hours'`,
      ),
    );

  if ((answers[0]?.samples ?? 0) > 0) {
    await measure('performance.answer_latency_p95_ms', {
      value: answers[0]?.p95 ?? 0,
      sampleSize: answers[0]?.samples ?? 0,
      evidence: { windowHours: 24, p50Ms: answers[0]?.p50 ?? 0 },
    });
  }
}

/**
 * Analytics integrity.
 *
 * Three invariants, each stated as an explicit formula rather than a feeling
 * that the numbers look plausible:
 *
 *   contamination  = events whose workspace differs from their Companion's
 *   duplicates     = events identical in session, type, file, page and second
 *   reconciliation = |companions.question_count - count(question events)|
 *
 * Tenancy is checked by joining through to the Companion rather than trusting
 * the denormalised column, because a denormalised column that is wrong is
 * exactly the defect being looked for.
 */
async function recordAnalyticsIntegrity(): Promise<void> {
  const { db } = container();

  const contamination = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.analyticsEvents)
    .innerJoin(schema.companions, eq(schema.companions.id, schema.analyticsEvents.companionId))
    .where(sql`${schema.analyticsEvents.workspaceId} IS DISTINCT FROM ${schema.companions.workspaceId}`);

  await measure('analytics.tenant_contamination', {
    value: contamination[0]?.value ?? 0,
    evidence: {
      rule: 'analytics_events.workspace_id must equal companions.workspace_id',
    },
  });

  const duplicates = await db.execute<{ value: number }>(sql`
    SELECT coalesce(sum(extra), 0)::int AS value
    FROM (
      SELECT count(*) - 1 AS extra
      FROM analytics_events
      WHERE occurred_at >= now() - interval '24 hours'
        AND recipient_session_id IS NOT NULL
      GROUP BY recipient_session_id, type, file_id, page,
               date_trunc('second', occurred_at)
      HAVING count(*) > 1
    ) AS repeated
  `);

  await measure('analytics.duplicate_events', {
    value: Number(duplicates[0]?.value ?? 0),
    evidence: {
      windowHours: 24,
      signature: 'recipient_session_id, type, file_id, page, second(occurred_at)',
    },
  });

  const drift = await db.execute<{ mismatches: number; sampled: number }>(sql`
    SELECT
      count(*) FILTER (WHERE c.question_count <> e.events)::int AS mismatches,
      count(*)::int AS sampled
    FROM companions c
    JOIN LATERAL (
      SELECT count(*)::int AS events
      FROM analytics_events a
      WHERE a.companion_id = c.id
        AND a.type IN ('question_asked', 'question_unanswered')
    ) e ON true
    WHERE c.deleted_at IS NULL
      AND c.question_count > 0
  `);

  const sampled = Number(drift[0]?.sampled ?? 0);
  if (sampled > 0) {
    await measure('analytics.reconciliation_errors', {
      value: Number(drift[0]?.mismatches ?? 0),
      sampleSize: sampled,
      evidence: {
        formula: "companions.question_count = count(analytics_events WHERE type IN ('question_asked','question_unanswered'))",
        companionsChecked: sampled,
      },
    });
  }
}

/**
 * Core Web Vitals, from the field.
 *
 * Reported at the 75th percentile across the last 28 days, which is how the
 * Web Vitals programme defines a "good" experience — a p50 would hide the
 * quarter of readers having a bad one. Lab numbers are deliberately not used:
 * the question is what real recipients' devices did.
 */
async function recordViewerVitals(): Promise<void> {
  const { db } = container();

  const rows = await db.execute<{ metric: string; p75: number; samples: number }>(sql`
    SELECT
      metric,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY value)::double precision AS p75,
      count(*)::int AS samples
    FROM viewer_vitals
    WHERE occurred_at >= now() - interval '28 days'
    GROUP BY metric
  `);

  const metricIds: Record<string, string> = {
    lcp: 'viewer.lcp_ms',
    inp: 'viewer.inp_ms',
    cls: 'viewer.cls',
    first_page: 'viewer.first_page_ms',
  };

  for (const row of rows) {
    const metricId = metricIds[row.metric];
    // ttfb is collected for diagnosis but is not itself a product promise.
    if (!metricId) continue;
    // A handful of samples cannot establish a percentile.
    if (Number(row.samples) < 20) continue;

    await measure(metricId, {
      value: Number(row.p75),
      sampleSize: Number(row.samples),
      evidence: { percentile: 75, windowDays: 28, source: 'field' },
    });
  }
}
