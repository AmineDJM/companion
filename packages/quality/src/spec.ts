import { z } from 'zod';

/**
 * The Companion quality specification.
 *
 * Every objectively measurable property of the product is declared here once,
 * with its measurement method, its thresholds and where those thresholds come
 * from. Nothing in the codebase may hard-code a quality threshold: a check
 * asks this specification, and every stored evaluation records the spec
 * version it was judged against so a regression can be attributed to a change
 * in the system rather than a change in the yardstick.
 */

export const SEVERITIES = ['CRITICAL', 'HARD_FAIL', 'WARNING', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Where a threshold comes from. This matters: a number we chose ourselves must
 * never be presented as an industry standard.
 */
export const THRESHOLD_ORIGINS = [
  'INDUSTRY_STANDARD',
  'SECURITY_REQUIREMENT',
  'COMPANION_HOUSE_STANDARD',
  'PROVIDER_REQUIREMENT',
] as const;
export type ThresholdOrigin = (typeof THRESHOLD_ORIGINS)[number];

export const COMPARISONS = ['gte', 'lte', 'eq', 'lt', 'gt'] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const REPAIR_STRATEGIES = [
  'none',
  'retry_extraction',
  'retry_vision_read',
  'regenerate_preview',
  'alternate_conversion',
  'reembed_missing',
  'reindex_file',
  'regenerate_signed_url',
  'invalidate_retrieval_cache',
  'requeue_job',
  'restore_from_source',
  'manual_investigation',
] as const;
export type RepairStrategy = (typeof REPAIR_STRATEGIES)[number];

export const metricSchema = z.object({
  /** Stable identifier, e.g. `ingestion.hash_match`. Never renamed in place. */
  metricId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  description: z.string().min(10),
  /** How the number is produced. Prose, but precise enough to reimplement. */
  measurementMethod: z.string().min(10),
  unit: z.enum(['ratio', 'percent', 'count', 'milliseconds', 'bytes', 'usd', 'boolean', 'score']),
  /** The direction that counts as better. */
  comparison: z.enum(COMPARISONS),
  target: z.number(),
  warningThreshold: z.number().nullable(),
  failureThreshold: z.number(),
  severity: z.enum(SEVERITIES),
  thresholdOrigin: z.enum(THRESHOLD_ORIGINS),
  /** Citation for an external standard, when one genuinely applies. */
  standardReference: z.string().nullable().default(null),
  repairStrategy: z.enum(REPAIR_STRATEGIES).default('none'),
  /** Set when a metric is only meaningful above a sample size. */
  minimumSampleSize: z.number().int().nonnegative().default(0),
});

export type QualityMetric = z.infer<typeof metricSchema>;

export const specFileSchema = z.object({
  domain: z.string().min(2),
  description: z.string().min(10),
  metrics: z.array(metricSchema).min(1),
});

export type QualitySpecFile = z.infer<typeof specFileSchema>;

export const specSchema = z.object({
  /** Semantic version of the specification as a whole. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  updatedAt: z.string(),
  domains: z.array(specFileSchema),
});

export type QualitySpec = z.infer<typeof specSchema>;

/**
 * A single measurement judged against the specification.
 *
 * `evidence` is the machine-readable proof: the inputs that produced the
 * value, so a pass can be justified later without rerunning anything.
 */
export interface Evaluation {
  metricId: string;
  value: number;
  passed: boolean;
  status: 'pass' | 'warn' | 'fail';
  severity: Severity;
  sampleSize: number;
  qualitySpecVersion: string;
  evidence: Record<string, unknown>;
  measuredAt: Date;
  repairStrategy: RepairStrategy;
  /** Set when the metric was skipped for want of a large enough sample. */
  skipped?: boolean;
}

export function compare(value: number, threshold: number, comparison: Comparison): boolean {
  switch (comparison) {
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    case 'lt':
      return value < threshold;
    case 'gt':
      return value > threshold;
  }
}

/** Judges one measurement. Returns `warn` only when a warning band is defined. */
export function evaluate(
  metric: QualityMetric,
  input: { value: number; sampleSize?: number; evidence?: Record<string, unknown> },
  specVersion: string,
  measuredAt: Date = new Date(),
): Evaluation {
  const sampleSize = input.sampleSize ?? 1;
  const base = {
    metricId: metric.metricId,
    value: input.value,
    sampleSize,
    severity: metric.severity,
    qualitySpecVersion: specVersion,
    evidence: input.evidence ?? {},
    measuredAt,
    repairStrategy: metric.repairStrategy,
  };

  if (sampleSize < metric.minimumSampleSize) {
    // Below the sample floor a ratio is noise; reporting it as a failure would
    // be worse than reporting nothing.
    return { ...base, passed: true, status: 'pass', skipped: true };
  }

  const meetsFailure = compare(input.value, metric.failureThreshold, metric.comparison);
  if (!meetsFailure) {
    return { ...base, passed: false, status: 'fail' };
  }

  if (metric.warningThreshold !== null) {
    const meetsWarning = compare(input.value, metric.warningThreshold, metric.comparison);
    if (!meetsWarning) return { ...base, passed: true, status: 'warn' };
  }

  return { ...base, passed: true, status: 'pass' };
}

export interface GateResult {
  passed: boolean;
  /** Failures that must block a release outright. */
  blocking: Evaluation[];
  warnings: Evaluation[];
  evaluations: Evaluation[];
  summary: string;
}

/**
 * Applies the release gate.
 *
 * Deliberately not a weighted average: a single CRITICAL or HARD_FAIL result
 * blocks, however good everything else looks. One score must never be able to
 * hide a cross-tenant leak behind good latency.
 */
export function applyGates(evaluations: Evaluation[]): GateResult {
  const failures = evaluations.filter((evaluation) => evaluation.status === 'fail');
  const blocking = failures.filter(
    (evaluation) => evaluation.severity === 'CRITICAL' || evaluation.severity === 'HARD_FAIL',
  );
  const warnings = [
    ...evaluations.filter((evaluation) => evaluation.status === 'warn'),
    ...failures.filter(
      (evaluation) => evaluation.severity === 'WARNING' || evaluation.severity === 'INFO',
    ),
  ];

  const summary = blocking.length
    ? `${blocking.length} blocking failure(s): ${blocking.map((entry) => entry.metricId).join(', ')}`
    : warnings.length
      ? `${warnings.length} warning(s), no blocking failures`
      : `${evaluations.length} metric(s) passed`;

  return { passed: blocking.length === 0, blocking, warnings, evaluations, summary };
}
