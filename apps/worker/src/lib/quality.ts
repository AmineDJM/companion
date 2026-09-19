import {
  applyGates,
  evaluate,
  metric,
  specVersion,
  type Evaluation,
  type GateResult,
} from '@companion/quality';
import { and, desc, eq, isNull, schema } from '@companion/db';
import { container } from '../container.js';

/**
 * Records quality evidence.
 *
 * Every measurement is written with the value, the thresholds it was judged
 * against and the inputs that produced it, so a pass can be justified later
 * without rerunning anything. A measurement that is never recorded is not a
 * measurement.
 */
export interface MeasurementContext {
  workspaceId?: string | null;
  companionId?: string | null;
  fileVersionId?: string | null;
  releaseId?: string | null;
  source?: 'worker' | 'ci' | 'api' | 'probe';
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
  const { db, logger } = container();
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
      releaseId: context.releaseId ?? releaseId(),
      source: context.source ?? 'worker',
      measuredAt: evaluation.measuredAt,
    });
  } catch (error) {
    // A lost measurement is a silent hole in the evidence, so it is loud.
    logger.error('quality evidence write failed', { metricId: evaluation.metricId, error });
  }
}

/** Records the outcome of an attempted repair against the finding that triggered it. */
export async function recordRepair(input: {
  metricId: string;
  fileVersionId?: string | null;
  companionId?: string | null;
  outcome: 'repaired' | 'unrepairable' | 'not_applicable';
  valueAfterRepair?: number | null;
}): Promise<void> {
  const { db, logger } = container();
  try {
    const conditions = [
      eq(schema.qualityEvaluations.metricId, input.metricId),
      eq(schema.qualityEvaluations.status, 'fail'),
      isNull(schema.qualityEvaluations.repairOutcome),
    ];
    if (input.fileVersionId) {
      conditions.push(eq(schema.qualityEvaluations.fileVersionId, input.fileVersionId));
    }
    if (input.companionId) {
      conditions.push(eq(schema.qualityEvaluations.companionId, input.companionId));
    }

    // Attach the outcome to the most recent unrepaired failure for this target,
    // which is the one the repair was triggered by.
    const target = await db
      .select({ id: schema.qualityEvaluations.id })
      .from(schema.qualityEvaluations)
      .where(and(...conditions))
      .orderBy(desc(schema.qualityEvaluations.measuredAt))
      .limit(1);

    const found = target[0];
    if (!found) return;

    await db
      .update(schema.qualityEvaluations)
      .set({
        repairAttemptedAt: new Date(),
        repairOutcome: input.outcome,
        valueAfterRepair: input.valueAfterRepair ?? null,
      })
      .where(eq(schema.qualityEvaluations.id, found.id));
  } catch (error) {
    logger.warn('repair outcome write failed', { metricId: input.metricId, error });
  }
}

export function releaseId(): string {
  return process.env['RENDER_GIT_COMMIT']?.slice(0, 12) ?? process.env['RELEASE_ID'] ?? 'dev';
}

export { applyGates, specVersion, type GateResult };
