import { COST_BASELINE, MODEL_PRICING } from '@companion/shared';
import { and, desc, eq, gte, schema, sql, ts } from '@companion/db';
import { getContainer } from '../container';
import { startOfUtcDay, startOfUtcMonth } from './admin';

/**
 * Unit economics.
 *
 * The central question this product must be able to answer: what does one
 * question cost, and which customers are unprofitable? Everything here reads
 * the usage ledger, which records provider-reported token counts and a cost
 * derived from the centralised pricing table.
 */
export interface CostBreakdown {
  totalCostUsd: number;
  answerCostUsd: number;
  embeddingCostUsd: number;
  questions: number;
  averageCostPerQuestionUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cachedRatio: number;
}

export async function costBreakdown(since: Date, until?: Date): Promise<CostBreakdown> {
  const { db } = getContainer();
  const conditions = [gte(schema.usageLedger.occurredAt, since)];
  if (until) conditions.push(sql`${schema.usageLedger.occurredAt} < ${ts(until)}`);

  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8`,
      answer: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'answer'), 0)::float8`,
      embedding: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}) FILTER (WHERE ${schema.usageLedger.requestKind} = 'embedding'), 0)::float8`,
      questions: sql<number>`count(*) FILTER (WHERE ${schema.usageLedger.billable})::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.usageLedger.inputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${schema.usageLedger.cachedInputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${schema.usageLedger.outputTokens}), 0)::bigint`,
    })
    .from(schema.usageLedger)
    .where(and(...conditions));

  const row = rows[0];
  const questions = row?.questions ?? 0;
  const inputTokens = Number(row?.inputTokens ?? 0);
  const cached = Number(row?.cachedInputTokens ?? 0);

  return {
    totalCostUsd: row?.total ?? 0,
    answerCostUsd: row?.answer ?? 0,
    embeddingCostUsd: row?.embedding ?? 0,
    questions,
    averageCostPerQuestionUsd: questions > 0 ? (row?.answer ?? 0) / questions : 0,
    inputTokens,
    cachedInputTokens: cached,
    outputTokens: Number(row?.outputTokens ?? 0),
    cachedRatio: inputTokens > 0 ? cached / inputTokens : 0,
  };
}

export interface DailyCost {
  day: string;
  questions: number;
  costUsd: number;
}

export async function dailyCosts(days = 30): Promise<DailyCost[]> {
  const { db } = getContainer();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{ day: string; questions: number; cost_usd: number }>(sql`
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      coalesce(count(u.id) FILTER (WHERE u.billable), 0)::int AS questions,
      coalesce(sum(u.estimated_cost_usd), 0)::float8 AS cost_usd
    FROM generate_series(${ts(since)}::date, now()::date, '1 day') AS d(day)
    LEFT JOIN usage_ledger u
      ON u.occurred_at >= d.day AND u.occurred_at < d.day + interval '1 day'
    GROUP BY d.day
    ORDER BY d.day
  `);
  return [...rows].map((row) => ({
    day: row.day,
    questions: row.questions,
    costUsd: row.cost_usd,
  }));
}

export interface WorkspaceEconomics {
  workspaceId: string;
  workspaceName: string;
  planKey: string;
  questions: number;
  costUsd: number;
  costPerQuestionUsd: number;
  /** Booked subscription value for the month, in USD, or 0 for Free. */
  revenueUsd: number;
  marginUsd: number;
  marginPercent: number | null;
  storageBytes: number;
}

const EUR_TO_USD = 1.08;

/**
 * Per-customer economics.
 *
 * Revenue is the booked subscription value, not collected cash — the two are
 * distinguished deliberately, because a past-due subscription still books MRR
 * while collecting nothing.
 */
export async function workspaceEconomics(options: {
  since?: Date;
  limit?: number;
  orderBy?: 'cost' | 'questions' | 'margin';
}): Promise<WorkspaceEconomics[]> {
  const { db } = getContainer();
  const since = options.since ?? startOfUtcMonth();
  const limit = options.limit ?? 20;

  const rows = await db
    .select({
      workspaceId: schema.workspaces.id,
      workspaceName: schema.workspaces.name,
      planKey: schema.workspaces.planKey,
      storageBytes: schema.workspaces.storageBytesUsed,
      questions: sql<number>`(SELECT count(*)::int FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.billable AND u.occurred_at >= ${ts(since)})`,
      costUsd: sql<number>`(SELECT coalesce(sum(u.estimated_cost_usd), 0)::float8 FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.occurred_at >= ${ts(since)})`,
      amountCents: sql<number>`(
        SELECT coalesce(
          CASE WHEN s.interval = 'annual' THEN s.amount_cents / 12.0 ELSE s.amount_cents END,
        0)::float8
        FROM ${schema.subscriptions} s
        WHERE s.workspace_id = ${schema.workspaces.id} AND s.status IN ('active','trialing','past_due')
        ORDER BY s.created_at DESC LIMIT 1
      )`,
    })
    .from(schema.workspaces)
    .where(sql`${schema.workspaces.deletedAt} IS NULL`)
    .orderBy(
      options.orderBy === 'questions'
        ? desc(sql`(SELECT count(*) FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.billable AND u.occurred_at >= ${ts(since)})`)
        : desc(sql`(SELECT coalesce(sum(u.estimated_cost_usd), 0) FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.occurred_at >= ${ts(since)})`),
    )
    .limit(limit);

  const economics = rows.map((row) => {
    const revenueUsd = (row.amountCents / 100) * EUR_TO_USD;
    const marginUsd = revenueUsd - row.costUsd;
    return {
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      planKey: row.planKey,
      questions: row.questions,
      costUsd: row.costUsd,
      costPerQuestionUsd: row.questions > 0 ? row.costUsd / row.questions : 0,
      revenueUsd,
      marginUsd,
      marginPercent: revenueUsd > 0 ? (marginUsd / revenueUsd) * 100 : null,
      storageBytes: row.storageBytes,
    };
  });

  if (options.orderBy === 'margin') {
    economics.sort((a, b) => a.marginUsd - b.marginUsd);
  }
  return economics;
}

/** Customers whose AI spend exceeds what they pay. */
export async function unprofitableWorkspaces(limit = 10): Promise<WorkspaceEconomics[]> {
  const all = await workspaceEconomics({ limit: 200, orderBy: 'margin' });
  return all.filter((row) => row.costUsd > 0 && row.marginUsd < 0).slice(0, limit);
}

export interface CompanionCost {
  companionId: string;
  companionName: string;
  workspaceName: string;
  questions: number;
  costUsd: number;
  storageBytes: number;
}

export async function companionCosts(limit = 20): Promise<CompanionCost[]> {
  const { db } = getContainer();
  const since = startOfUtcMonth();

  const rows = await db
    .select({
      companionId: schema.companions.id,
      companionName: schema.companions.name,
      workspaceName: schema.workspaces.name,
      storageBytes: schema.companions.storageBytes,
      questions: sql<number>`(SELECT count(*)::int FROM ${schema.usageLedger} u WHERE u.companion_id = ${schema.companions.id} AND u.billable AND u.occurred_at >= ${ts(since)})`,
      costUsd: sql<number>`(SELECT coalesce(sum(u.estimated_cost_usd), 0)::float8 FROM ${schema.usageLedger} u WHERE u.companion_id = ${schema.companions.id} AND u.occurred_at >= ${ts(since)})`,
    })
    .from(schema.companions)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.companions.workspaceId))
    .where(sql`${schema.companions.deletedAt} IS NULL`)
    .orderBy(
      desc(sql`(SELECT coalesce(sum(u.estimated_cost_usd), 0) FROM ${schema.usageLedger} u WHERE u.companion_id = ${schema.companions.id} AND u.occurred_at >= ${ts(since)})`),
    )
    .limit(limit);

  return rows;
}

export interface CostAlert {
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
}

/**
 * Cost alerting.
 *
 * Fires on the things that actually indicate a problem: a spike in the average
 * cost per question, unexpected context growth, a rising provider error rate,
 * and any workspace approaching the monthly spend threshold.
 */
export async function costAlerts(): Promise<CostAlert[]> {
  const { db } = getContainer();
  const alerts: CostAlert[] = [];

  const today = await costBreakdown(startOfUtcDay());
  if (
    today.questions >= 20 &&
    today.averageCostPerQuestionUsd >
      COST_BASELINE.targetCostPerQuestionUsd * COST_BASELINE.alertMultiplier
  ) {
    alerts.push({
      severity: 'critical',
      title: 'Average cost per question has spiked',
      detail: `$${today.averageCostPerQuestionUsd.toFixed(5)} today against a $${COST_BASELINE.targetCostPerQuestionUsd.toFixed(5)} target.`,
    });
  }

  if (today.questions >= 20) {
    const averageInput = today.inputTokens / Math.max(today.questions, 1);
    if (averageInput > COST_BASELINE.targetInputTokens * 1.8) {
      alerts.push({
        severity: 'warning',
        title: 'Retrieved context is larger than planned',
        detail: `${Math.round(averageInput).toLocaleString()} input tokens per question against a ${COST_BASELINE.targetInputTokens.toLocaleString()} target.`,
      });
    }
  }

  const errorRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) FILTER (WHERE NOT ${schema.usageLedger.succeeded})::int`,
    })
    .from(schema.usageLedger)
    .where(gte(schema.usageLedger.occurredAt, new Date(Date.now() - 60 * 60 * 1000)));
  const errorRow = errorRows[0];
  if ((errorRow?.total ?? 0) >= 20 && (errorRow?.errors ?? 0) / (errorRow?.total ?? 1) > 0.1) {
    alerts.push({
      severity: 'critical',
      title: 'Provider error rate is elevated',
      detail: `${errorRow?.errors} of ${errorRow?.total} calls failed in the last hour.`,
    });
  }

  const settings = await db.select().from(schema.platformSettings).limit(1);
  const threshold = settings[0]?.limits.workspaceMonthlySpendAlertUsd ?? 50;

  const heavy = await db
    .select({
      name: schema.workspaces.name,
      id: schema.workspaces.id,
      costUsd: sql<number>`(SELECT coalesce(sum(u.estimated_cost_usd), 0)::float8 FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.occurred_at >= ${ts(startOfUtcMonth())})`,
    })
    .from(schema.workspaces)
    .where(sql`${schema.workspaces.deletedAt} IS NULL`)
    .orderBy(
      desc(sql`(SELECT coalesce(sum(u.estimated_cost_usd), 0) FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.occurred_at >= ${ts(startOfUtcMonth())})`),
    )
    .limit(5);

  for (const workspace of heavy) {
    if (workspace.costUsd >= threshold) {
      alerts.push({
        severity: 'warning',
        title: `${workspace.name} has high AI spend`,
        detail: `$${workspace.costUsd.toFixed(2)} this month, above the $${threshold} alert threshold.`,
      });
    }
  }

  return alerts;
}

export { MODEL_PRICING };
