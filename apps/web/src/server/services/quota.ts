import {
  AppError,
  QUOTA_CONSUMING_STATUSES,
  adjustmentAppliesToCycle,
  calendarCycle,
  computeCompanionSlots,
  computeQuotaState,
  type BillingCycle,
  type CompanionSlotState,
  type Entitlements,
  type QuotaState,
} from '@companion/shared';
import { and, eq, gte, inArray, lt, schema, sql } from '@companion/db';
import { getContainer } from '../container';

/**
 * Quota accounting.
 *
 * Consumption is counted from the usage ledger (`billable = true`), never from
 * a mutable counter, so granting questions is always an append and never an
 * edit to history. All counts are server-side; the client is never trusted.
 */
export interface WorkspaceQuotaContext {
  workspaceId: string;
  billingAnchorAt: Date;
  entitlements: Entitlements;
  /** Stripe period when a subscription exists; otherwise the calendar cycle. */
  periodStart: Date | null;
  periodEnd: Date | null;
}

export function resolveCycle(context: WorkspaceQuotaContext, now: Date = new Date()): BillingCycle {
  if (context.periodStart && context.periodEnd && context.periodEnd.getTime() > now.getTime()) {
    return { start: context.periodStart, end: context.periodEnd };
  }
  return calendarCycle(context.billingAnchorAt, now);
}

export async function getQuotaState(
  context: WorkspaceQuotaContext,
  now: Date = new Date(),
): Promise<QuotaState & { cycle: BillingCycle }> {
  const { db } = getContainer();
  const cycle = resolveCycle(context, now);

  const [consumedRows, adjustmentRows, purchaseRows] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.usageLedger)
      .where(
        and(
          eq(schema.usageLedger.workspaceId, context.workspaceId),
          eq(schema.usageLedger.billable, true),
          gte(schema.usageLedger.occurredAt, cycle.start),
          lt(schema.usageLedger.occurredAt, cycle.end),
        ),
      ),
    db
      .select()
      .from(schema.usageAdjustments)
      .where(eq(schema.usageAdjustments.workspaceId, context.workspaceId)),
    db
      .select()
      .from(schema.usagePurchases)
      .where(eq(schema.usagePurchases.workspaceId, context.workspaceId)),
  ]);

  const adjustments = adjustmentRows
    .filter((row) =>
      adjustmentAppliesToCycle(
        { createdAt: row.createdAt, expiresAt: row.expiresAt, recurring: row.recurring },
        cycle,
        now,
      ),
    )
    .reduce((total, row) => total + row.amount, 0);

  const purchased = purchaseRows
    .filter((row) => row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
    .filter((row) => row.createdAt.getTime() < cycle.end.getTime())
    .reduce((total, row) => total + row.questions, 0);

  const state = computeQuotaState({
    planAllowance: context.entitlements.monthlyQuestions,
    purchased,
    adjustments,
    consumed: consumedRows[0]?.value ?? 0,
  });

  return { ...state, cycle };
}

/** Counts Companions that occupy a slot of the plan's allowance. */
export async function getCompanionSlots(
  workspaceId: string,
  entitlements: Entitlements,
): Promise<CompanionSlotState> {
  const { db } = getContainer();
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.companions)
    .where(
      and(
        eq(schema.companions.workspaceId, workspaceId),
        sql`${schema.companions.deletedAt} IS NULL`,
        inArray(schema.companions.status, [...QUOTA_CONSUMING_STATUSES]),
      ),
    );
  return computeCompanionSlots(rows[0]?.value ?? 0, entitlements);
}

/**
 * Guards Companion creation. A downgrade never destroys data: the customer is
 * asked to archive something instead.
 */
export async function assertCanCreateCompanion(
  workspaceId: string,
  entitlements: Entitlements,
): Promise<void> {
  const slots = await getCompanionSlots(workspaceId, entitlements);
  if (!slots.exhausted) return;
  throw new AppError(
    'quota_exceeded',
    `Your plan includes ${slots.limit} active Companions. Archive one, or upgrade to create more.`,
    { details: { used: slots.used, limit: slots.limit } },
  );
}

export async function assertCanAskQuestion(
  context: WorkspaceQuotaContext,
): Promise<QuotaState & { cycle: BillingCycle }> {
  const state = await getQuotaState(context);
  if (state.exhausted) {
    // Recipient-facing wording: never expose the sender's plan details.
    throw new AppError('quota_exceeded', 'Questions are temporarily unavailable for this document.');
  }
  return state;
}

export async function assertStorageAvailable(
  workspaceId: string,
  entitlements: Entitlements,
  additionalBytes: number,
): Promise<void> {
  const { db } = getContainer();
  const rows = await db
    .select({ used: schema.workspaces.storageBytesUsed })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const used = rows[0]?.used ?? 0;
  if (used + additionalBytes > entitlements.storageBytes) {
    throw new AppError(
      'quota_exceeded',
      'This upload would exceed your storage allowance. Remove a Companion or upgrade your plan.',
      { details: { usedBytes: used, limitBytes: entitlements.storageBytes } },
    );
  }
}

/** Adjusts the denormalised storage counter. Negative deltas are allowed. */
export async function adjustStorageUsage(workspaceId: string, deltaBytes: number): Promise<void> {
  if (deltaBytes === 0) return;
  const { db } = getContainer();
  await db
    .update(schema.workspaces)
    .set({
      storageBytesUsed: sql`GREATEST(${schema.workspaces.storageBytesUsed} + ${deltaBytes}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));
}
