import { estimateCostUsd, type AiRequestKind } from '@companion/shared';
import { and, eq, gte, lt, schema, sql } from '@companion/db';
import { getContainer } from '../container';

/**
 * Usage ledger.
 *
 * Every model call is written here with the provider's *reported* token counts
 * and a cost derived from the centralised pricing table. Failed provider calls
 * are recorded but never marked billable, so an outage does not consume a
 * customer's question allowance.
 */
export interface LedgerEntry {
  workspaceId: string | null;
  companionId?: string | null;
  recipientSessionId?: string | null;
  questionId?: string | null;
  provider: string;
  model: string;
  requestKind: AiRequestKind;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs: number;
  succeeded: boolean;
  /** True only for a successful recipient answer. */
  billable: boolean;
  errorCode?: string | null;
  requestId?: string | null;
}

export async function recordUsage(entry: LedgerEntry): Promise<number> {
  const { db, logger } = getContainer();
  const cost = estimateCostUsd(entry.model, {
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
  });

  try {
    await db.insert(schema.usageLedger).values({
      workspaceId: entry.workspaceId,
      companionId: entry.companionId ?? null,
      recipientSessionId: entry.recipientSessionId ?? null,
      questionId: entry.questionId ?? null,
      provider: entry.provider,
      model: entry.model,
      requestKind: entry.requestKind,
      inputTokens: entry.inputTokens,
      cachedInputTokens: entry.cachedInputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      reasoningTokens: entry.reasoningTokens ?? 0,
      estimatedCostUsd: cost,
      latencyMs: entry.latencyMs,
      succeeded: entry.succeeded,
      billable: entry.billable && entry.succeeded,
      errorCode: entry.errorCode ?? null,
      requestId: entry.requestId ?? null,
      occurredAt: new Date(),
    });
  } catch (error) {
    // Losing a ledger row corrupts unit economics; make the failure loud.
    logger.error('usage ledger write failed', {
      workspaceId: entry.workspaceId ?? undefined,
      requestKind: entry.requestKind,
      error,
    });
  }

  return cost;
}

/**
 * Emergency spend cap. Protects against a publicly shared Companion generating
 * unbounded provider spend, without cutting off a paying customer for a small
 * overage — the alert threshold fires first and surfaces in /admin.
 */
export async function workspaceSpendThisMonth(workspaceId: string): Promise<number> {
  const { db } = getContainer();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({ value: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8` })
    .from(schema.usageLedger)
    .where(
      and(
        eq(schema.usageLedger.workspaceId, workspaceId),
        gte(schema.usageLedger.occurredAt, start),
      ),
    );
  return rows[0]?.value ?? 0;
}

export interface UsageSummary {
  questions: number;
  answers: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  answerCostUsd: number;
  embeddingCostUsd: number;
  totalCostUsd: number;
  averageCostPerQuestionUsd: number;
  averageLatencyMs: number;
}

export async function usageSummary(options: {
  workspaceId?: string | null;
  companionId?: string | null;
  since?: Date;
  until?: Date;
}): Promise<UsageSummary> {
  const { db } = getContainer();
  const conditions = [];
  if (options.workspaceId) conditions.push(eq(schema.usageLedger.workspaceId, options.workspaceId));
  if (options.companionId) conditions.push(eq(schema.usageLedger.companionId, options.companionId));
  if (options.since) conditions.push(gte(schema.usageLedger.occurredAt, options.since));
  if (options.until) conditions.push(lt(schema.usageLedger.occurredAt, options.until));

  const rows = await db
    .select({
      questions: sql<number>`count(*) FILTER (WHERE ${schema.usageLedger.billable})::int`,
      answers: sql<number>`count(*) FILTER (WHERE ${schema.usageLedger.requestKind} = 'answer' AND ${schema.usageLedger.succeeded})::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.usageLedger.inputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${schema.usageLedger.cachedInputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${schema.usageLedger.outputTokens}), 0)::bigint`,
      answerCostUsd: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'answer'), 0)::float8`,
      embeddingCostUsd: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'embedding'), 0)::float8`,
      totalCostUsd: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8`,
      averageLatencyMs: sql<number>`coalesce(avg(${schema.usageLedger.latencyMs}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'answer'), 0)::float8`,
    })
    .from(schema.usageLedger)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const row = rows[0];
  const questions = Number(row?.questions ?? 0);
  const totalCostUsd = Number(row?.totalCostUsd ?? 0);
  return {
    questions,
    answers: Number(row?.answers ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    cachedInputTokens: Number(row?.cachedInputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    answerCostUsd: Number(row?.answerCostUsd ?? 0),
    embeddingCostUsd: Number(row?.embeddingCostUsd ?? 0),
    totalCostUsd,
    averageCostPerQuestionUsd: questions > 0 ? totalCostUsd / questions : 0,
    averageLatencyMs: Number(row?.averageLatencyMs ?? 0),
  };
}
