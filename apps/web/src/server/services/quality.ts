import {
  applyGates,
  evaluate,
  metric,
  specVersion,
  type Evaluation,
  type GateResult,
} from '@companion/quality';
import { schema } from '@companion/db';
import { getContainer } from '../container';

/**
 * Quality evidence, request side.
 *
 * The worker measures what it produces; this measures what is served. Both
 * write the same rows against the same versioned specification, so a metric
 * means one thing regardless of which process observed it.
 */
export interface MeasurementContext {
  workspaceId?: string | null;
  companionId?: string | null;
  fileVersionId?: string | null;
  source?: 'worker' | 'ci' | 'api' | 'probe';
}

export function releaseId(): string {
  return process.env['RENDER_GIT_COMMIT']?.slice(0, 12) ?? process.env['RELEASE_ID'] ?? 'dev';
}

export async function measure(
  metricId: string,
  input: { value: number; sampleSize?: number; evidence?: Record<string, unknown> },
  context: MeasurementContext = {},
): Promise<Evaluation> {
  const definition = metric(metricId);
  const evaluation = evaluate(definition, input, specVersion());
  await persist(evaluation, context);
  return evaluation;
}

export async function persist(
  evaluation: Evaluation,
  context: MeasurementContext = {},
): Promise<void> {
  const { db, logger } = getContainer();
  try {
    await db.insert(schema.qualityEvaluations).values({
      metricId: evaluation.metricId,
      qualitySpecVersion: evaluation.qualitySpecVersion,
      value: evaluation.value,
      status: evaluation.status,
      severity: evaluation.severity,
      sampleSize: evaluation.sampleSize,
      evidence: evaluation.evidence,
      repairStrategy: evaluation.repairStrategy,
      workspaceId: context.workspaceId ?? null,
      companionId: context.companionId ?? null,
      fileVersionId: context.fileVersionId ?? null,
      releaseId: releaseId(),
      source: context.source ?? 'api',
      measuredAt: evaluation.measuredAt,
    });
  } catch (error) {
    // Never fail a recipient's request because evidence could not be written,
    // but never lose the fact that it could not be written either.
    logger.error('quality evidence write failed', { metricId: evaluation.metricId, error });
  }
}

export { applyGates, specVersion, type Evaluation, type GateResult };
