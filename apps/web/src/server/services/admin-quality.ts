import { loadSpec, specVersion, type QualityMetric } from '@companion/quality';
import { schema, sql } from '@companion/db';
import { getContainer } from '../container';

/**
 * The quality console's data.
 *
 * Reads the evidence the rest of the system wrote. It computes nothing new and
 * softens nothing: a metric with no measurements is reported as unmeasured
 * rather than as passing, because "we never checked" and "we checked and it
 * was fine" are different facts and only one of them is reassuring.
 */
export type MetricStatus = 'pass' | 'warn' | 'fail' | 'unmeasured';

export interface MetricRow {
  definition: QualityMetric;
  domain: string;
  status: MetricStatus;
  latestValue: number | null;
  sampleSize: number | null;
  measuredAt: Date | null;
  measurements: number;
  failures: number;
  /** Evidence from the most recent failure, for diagnosis. */
  lastFailureEvidence: Record<string, unknown> | null;
  repairsAttempted: number;
  repairsSucceeded: number;
}

export interface QualityOverview {
  qualitySpecVersion: string;
  windowHours: number;
  metrics: MetricRow[];
  blocking: MetricRow[];
  warnings: MetricRow[];
  unmeasured: MetricRow[];
  counts: { pass: number; warn: number; fail: number; unmeasured: number };
  releaseComparison: ReleaseSummary[];
}

interface ReleaseRow extends Record<string, unknown> {
  releaseId: string;
  measurements: number;
  failures: number;
  blockingFailures: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface ReleaseSummary {
  releaseId: string;
  measurements: number;
  failures: number;
  blockingFailures: number;
  firstSeen: Date;
  lastSeen: Date;
}

interface LatestRow extends Record<string, unknown> {
  metricId: string;
  value: number;
  status: string;
  sampleSize: number | null;
  evidence: Record<string, unknown> | null;
  measuredAt: Date;
  measurements: number;
  failures: number;
  lastFailureEvidence: Record<string, unknown> | null;
  repairsAttempted: number;
  repairsSucceeded: number;
}

export async function qualityOverview(windowHours = 168): Promise<QualityOverview> {
  const { db } = getContainer();
  const spec = loadSpec();

  const rows = await db.execute<LatestRow>(sql`
    WITH windowed AS (
      SELECT *
      FROM quality_evaluations
      WHERE measured_at >= now() - make_interval(hours => ${windowHours})
    ),
    latest AS (
      SELECT DISTINCT ON (metric_id)
        metric_id, value, status, sample_size, evidence, measured_at
      FROM windowed
      ORDER BY metric_id, measured_at DESC
    ),
    failures AS (
      SELECT DISTINCT ON (metric_id) metric_id, evidence
      FROM windowed
      WHERE status = 'fail'
      ORDER BY metric_id, measured_at DESC
    ),
    totals AS (
      SELECT
        metric_id,
        count(*)::int AS measurements,
        count(*) FILTER (WHERE status = 'fail')::int AS failures,
        count(*) FILTER (WHERE repair_attempted_at IS NOT NULL)::int AS repairs_attempted,
        count(*) FILTER (WHERE repair_outcome = 'repaired')::int AS repairs_succeeded
      FROM windowed
      GROUP BY metric_id
    )
    SELECT
      l.metric_id       AS "metricId",
      l.value           AS value,
      l.status          AS status,
      l.sample_size     AS "sampleSize",
      l.evidence        AS evidence,
      l.measured_at     AS "measuredAt",
      t.measurements    AS measurements,
      t.failures        AS failures,
      f.evidence        AS "lastFailureEvidence",
      t.repairs_attempted AS "repairsAttempted",
      t.repairs_succeeded AS "repairsSucceeded"
    FROM latest l
    JOIN totals t ON t.metric_id = l.metric_id
    LEFT JOIN failures f ON f.metric_id = l.metric_id
  `);

  const byMetric = new Map(rows.map((row) => [row.metricId, row]));

  const metrics: MetricRow[] = [];
  for (const domain of spec.domains) {
    for (const definition of domain.metrics) {
      const row = byMetric.get(definition.metricId);
      metrics.push({
        definition,
        domain: domain.domain,
        status: row ? normaliseStatus(row.status) : 'unmeasured',
        latestValue: row ? Number(row.value) : null,
        sampleSize: row?.sampleSize ?? null,
        measuredAt: row ? new Date(row.measuredAt) : null,
        measurements: row?.measurements ?? 0,
        failures: row?.failures ?? 0,
        lastFailureEvidence: row?.lastFailureEvidence ?? null,
        repairsAttempted: row?.repairsAttempted ?? 0,
        repairsSucceeded: row?.repairsSucceeded ?? 0,
      });
    }
  }

  const counts = {
    pass: metrics.filter((metric) => metric.status === 'pass').length,
    warn: metrics.filter((metric) => metric.status === 'warn').length,
    fail: metrics.filter((metric) => metric.status === 'fail').length,
    unmeasured: metrics.filter((metric) => metric.status === 'unmeasured').length,
  };

  return {
    qualitySpecVersion: specVersion(),
    windowHours,
    metrics,
    // A single weighted score is deliberately not produced: one number would
    // let good latency average away a cross-tenant leak.
    blocking: metrics.filter(
      (metric) =>
        metric.status === 'fail' &&
        (metric.definition.severity === 'CRITICAL' || metric.definition.severity === 'HARD_FAIL'),
    ),
    warnings: metrics.filter(
      (metric) =>
        metric.status === 'warn' ||
        (metric.status === 'fail' && metric.definition.severity === 'WARNING'),
    ),
    unmeasured: metrics.filter((metric) => metric.status === 'unmeasured'),
    counts,
    releaseComparison: await releaseComparison(),
  };
}

function normaliseStatus(value: string): MetricStatus {
  return value === 'pass' || value === 'warn' || value === 'fail' ? value : 'unmeasured';
}

/** Per-release totals, so a regression is attributable to a deploy. */
async function releaseComparison(): Promise<ReleaseSummary[]> {
  const { db } = getContainer();
  const rows = await db.execute<ReleaseRow>(sql`
    SELECT
      release_id AS "releaseId",
      count(*)::int AS measurements,
      count(*) FILTER (WHERE status = 'fail')::int AS failures,
      count(*) FILTER (WHERE status = 'fail' AND severity IN ('CRITICAL', 'HARD_FAIL'))::int
        AS "blockingFailures",
      min(measured_at) AS "firstSeen",
      max(measured_at) AS "lastSeen"
    FROM quality_evaluations
    WHERE release_id IS NOT NULL
    GROUP BY release_id
    ORDER BY max(measured_at) DESC
    LIMIT 8
  `);

  return rows.map((row) => ({
    releaseId: row.releaseId,
    measurements: Number(row.measurements),
    failures: Number(row.failures),
    blockingFailures: Number(row.blockingFailures),
    firstSeen: new Date(row.firstSeen),
    lastSeen: new Date(row.lastSeen),
  }));
}

export interface QualityRunRow {
  id: string;
  kind: string;
  releaseId: string;
  passed: boolean;
  blockingFailures: number;
  warnings: number;
  headline: Record<string, number>;
  summary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}

export async function recentQualityRuns(limit = 10): Promise<QualityRunRow[]> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.qualityRuns)
    .orderBy(sql`${schema.qualityRuns.startedAt} DESC`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    releaseId: row.releaseId,
    passed: row.passed,
    blockingFailures: row.blockingFailures,
    warnings: row.warnings,
    headline: row.headline,
    summary: row.summary,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
  }));
}
