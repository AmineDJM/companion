import {
  AppError,
  COST_BASELINE,
  QUOTA_CONSUMING_STATUSES,
  adjustmentAppliesToCycle,
  calendarCycle,
  computeQuotaState,
  isPlanKey,
  type PlanKey,
  type UsageAdjustmentType,
} from '@companion/shared';
import { and, desc, eq, gte, inArray, isNull, or, schema, sql, ts } from '@companion/db';
import { getContainer } from '../container';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { invalidateLimitsCache, invalidatePlanCache, resolveEntitlements } from './entitlements';
import { monthlyRecurringRevenueCents } from './billing';

/**
 * Super Admin data access.
 *
 * Every function here reads or writes real state — there are no placeholder
 * metrics. Production dashboards start at genuine zeros, and each mutation
 * writes an audit entry naming the operator who made it.
 */

export interface PlatformOverview {
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  freeWorkspaces: number;
  trialingSubscriptions: number;
  newCustomersThisMonth: number;
  activeUsers: number;
  activeCompanions: number;
  companionsToday: number;
  questionsToday: number;
  questionsThisMonth: number;
  aiCostTodayUsd: number;
  aiCostMonthUsd: number;
  averageCostPerQuestionUsd: number;
  storageBytes: number;
  jobsToday: number;
  jobFailureRate: number;
  failedPayments: number;
  estimatedGrossMarginPercent: number | null;
}

export async function platformOverview(): Promise<PlatformOverview> {
  const { db } = getContainer();
  const dayStart = startOfUtcDay();
  const monthStart = startOfUtcMonth();

  const [mrrCents, counts, usageToday, usageMonth, jobs, payments] = await Promise.all([
    monthlyRecurringRevenueCents(),
    db
      .select({
        activeSubscriptions: sql<number>`(SELECT count(*)::int FROM ${schema.subscriptions} WHERE status = 'active')`,
        trialing: sql<number>`(SELECT count(*)::int FROM ${schema.subscriptions} WHERE status = 'trialing')`,
        freeWorkspaces: sql<number>`(SELECT count(*)::int FROM ${schema.workspaces} WHERE plan_key = 'free' AND deleted_at IS NULL)`,
        newCustomers: sql<number>`(SELECT count(*)::int FROM ${schema.workspaces} WHERE created_at >= ${ts(monthStart)})`,
        activeUsers: sql<number>`(SELECT count(*)::int FROM ${schema.users} WHERE last_seen_at >= now() - interval '30 days')`,
        activeCompanions: sql<number>`(SELECT count(*)::int FROM ${schema.companions} WHERE status = 'ACTIVE' AND deleted_at IS NULL)`,
        companionsToday: sql<number>`(SELECT count(*)::int FROM ${schema.companions} WHERE created_at >= ${ts(dayStart)})`,
        storageBytes: sql<number>`(SELECT coalesce(sum(storage_bytes), 0)::bigint FROM ${schema.companions} WHERE deleted_at IS NULL)`,
      })
      .from(sql`(SELECT 1) AS anchor`),
    usageTotals(dayStart),
    usageTotals(monthStart),
    db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'FAILED')::int`,
      })
      .from(schema.processingJobs)
      .where(gte(schema.processingJobs.createdAt, dayStart)),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.payments)
      .where(and(eq(schema.payments.status, 'failed'), gte(schema.payments.occurredAt, monthStart))),
  ]);

  const row = counts[0];
  const jobRow = jobs[0];
  const jobsTotal = jobRow?.total ?? 0;

  // Gross margin uses AI spend only; infrastructure is not attributable per
  // customer, so it is deliberately excluded rather than guessed at.
  const monthRevenueUsd = (mrrCents / 100) * 1.08; // rough EUR->USD for comparison
  const grossMargin =
    monthRevenueUsd > 0
      ? Math.round(((monthRevenueUsd - usageMonth.costUsd) / monthRevenueUsd) * 100)
      : null;

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    activeSubscriptions: row?.activeSubscriptions ?? 0,
    trialingSubscriptions: row?.trialing ?? 0,
    freeWorkspaces: row?.freeWorkspaces ?? 0,
    newCustomersThisMonth: row?.newCustomers ?? 0,
    activeUsers: row?.activeUsers ?? 0,
    activeCompanions: row?.activeCompanions ?? 0,
    companionsToday: row?.companionsToday ?? 0,
    questionsToday: usageToday.questions,
    questionsThisMonth: usageMonth.questions,
    aiCostTodayUsd: usageToday.costUsd,
    aiCostMonthUsd: usageMonth.costUsd,
    averageCostPerQuestionUsd:
      usageMonth.questions > 0 ? usageMonth.costUsd / usageMonth.questions : 0,
    storageBytes: Number(row?.storageBytes ?? 0),
    jobsToday: jobsTotal,
    jobFailureRate: jobsTotal > 0 ? (jobRow?.failed ?? 0) / jobsTotal : 0,
    failedPayments: payments[0]?.value ?? 0,
    estimatedGrossMarginPercent: grossMargin,
  };
}

async function usageTotals(since: Date): Promise<{ questions: number; costUsd: number }> {
  const { db } = getContainer();
  const rows = await db
    .select({
      questions: sql<number>`count(*) FILTER (WHERE ${schema.usageLedger.billable})::int`,
      costUsd: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8`,
    })
    .from(schema.usageLedger)
    .where(gte(schema.usageLedger.occurredAt, since));
  return { questions: rows[0]?.questions ?? 0, costUsd: rows[0]?.costUsd ?? 0 };
}

export function startOfUtcDay(date = new Date()): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export function startOfUtcMonth(date = new Date()): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

/** Global search across users, workspaces, Companions and Stripe identifiers. */
export interface SearchResult {
  kind: 'user' | 'workspace' | 'companion' | 'subscription';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export async function adminSearch(query: string): Promise<SearchResult[]> {
  const { db } = getContainer();
  const term = query.trim();
  if (term.length === 0) return [];
  const pattern = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;

  const [users, workspaces, companions, subscriptions] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        workspaceId: schema.workspaceMembers.workspaceId,
      })
      .from(schema.users)
      .leftJoin(schema.workspaceMembers, eq(schema.workspaceMembers.userId, schema.users.id))
      .where(or(sql`${schema.users.email} ILIKE ${pattern}`, sql`${schema.users.name} ILIKE ${pattern}`))
      .limit(8),
    db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        planKey: schema.workspaces.planKey,
        stripeCustomerId: schema.workspaces.stripeCustomerId,
      })
      .from(schema.workspaces)
      .where(
        or(
          sql`${schema.workspaces.name} ILIKE ${pattern}`,
          sql`${schema.workspaces.slug} ILIKE ${pattern}`,
          eq(schema.workspaces.stripeCustomerId, term),
        ),
      )
      .limit(8),
    db
      .select({
        id: schema.companions.id,
        name: schema.companions.name,
        slug: schema.companions.slug,
        status: schema.companions.status,
      })
      .from(schema.companions)
      .where(
        or(sql`${schema.companions.name} ILIKE ${pattern}`, eq(schema.companions.slug, term)),
      )
      .limit(8),
    db
      .select({
        id: schema.subscriptions.id,
        workspaceId: schema.subscriptions.workspaceId,
        stripeId: schema.subscriptions.stripeSubscriptionId,
        planKey: schema.subscriptions.planKey,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.stripeSubscriptionId, term))
      .limit(5),
  ]);

  return [
    ...users.map((user) => ({
      kind: 'user' as const,
      id: user.id,
      title: user.email,
      subtitle: user.name ?? 'User',
      href: user.workspaceId ? `/admin/customers/${user.workspaceId}` : '/admin/customers',
    })),
    ...workspaces.map((workspace) => ({
      kind: 'workspace' as const,
      id: workspace.id,
      title: workspace.name,
      subtitle: `${workspace.planKey}${workspace.stripeCustomerId ? ` · ${workspace.stripeCustomerId}` : ''}`,
      href: `/admin/customers/${workspace.id}`,
    })),
    ...companions.map((companion) => ({
      kind: 'companion' as const,
      id: companion.id,
      title: companion.name,
      subtitle: `/c/${companion.slug} · ${companion.status}`,
      href: `/admin/companions/${companion.id}`,
    })),
    ...subscriptions.map((subscription) => ({
      kind: 'subscription' as const,
      id: subscription.id,
      title: subscription.stripeId ?? subscription.id,
      subtitle: subscription.planKey,
      href: `/admin/customers/${subscription.workspaceId}`,
    })),
  ];
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  planKey: string;
  status: string;
  ownerEmail: string | null;
  companions: number;
  questionsThisCycle: number;
  costUsdThisMonth: number;
  storageBytes: number;
  createdAt: Date;
}

export async function listWorkspaces(options: {
  query?: string;
  planKey?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AdminWorkspaceRow[]; total: number }> {
  const { db } = getContainer();
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const monthStart = startOfUtcMonth();

  const conditions = [isNull(schema.workspaces.deletedAt)];
  if (options.query) {
    const pattern = `%${options.query.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const clause = or(
      sql`${schema.workspaces.name} ILIKE ${pattern}`,
      sql`${schema.users.email} ILIKE ${pattern}`,
    );
    if (clause) conditions.push(clause);
  }
  if (options.planKey && isPlanKey(options.planKey)) {
    conditions.push(eq(schema.workspaces.planKey, options.planKey));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        planKey: schema.workspaces.planKey,
        status: schema.workspaces.status,
        storageBytes: schema.workspaces.storageBytesUsed,
        createdAt: schema.workspaces.createdAt,
        ownerEmail: schema.users.email,
        companions: sql<number>`(SELECT count(*)::int FROM ${schema.companions} c WHERE c.workspace_id = ${schema.workspaces.id} AND c.deleted_at IS NULL)`,
        questions: sql<number>`(SELECT count(*)::int FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.billable AND u.occurred_at >= ${ts(monthStart)})`,
        costUsd: sql<number>`(SELECT coalesce(sum(u.estimated_cost_usd), 0)::float8 FROM ${schema.usageLedger} u WHERE u.workspace_id = ${schema.workspaces.id} AND u.occurred_at >= ${ts(monthStart)})`,
      })
      .from(schema.workspaces)
      .leftJoin(schema.users, eq(schema.users.id, schema.workspaces.ownerId))
      .where(where)
      .orderBy(desc(schema.workspaces.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.workspaces)
      .leftJoin(schema.users, eq(schema.users.id, schema.workspaces.ownerId))
      .where(where),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      planKey: row.planKey,
      status: row.status,
      ownerEmail: row.ownerEmail,
      companions: row.companions,
      questionsThisCycle: row.questions,
      costUsdThisMonth: row.costUsd,
      storageBytes: row.storageBytes,
      createdAt: row.createdAt,
    })),
    total: totals[0]?.value ?? 0,
  };
}

/** Everything an operator needs to answer a support ticket about one customer. */
export async function workspaceDetail(workspaceId: string) {
  const { db } = getContainer();
  const monthStart = startOfUtcMonth();

  const workspaceRows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) throw new AppError('not_found', 'Workspace not found.');

  const [
    members,
    subscription,
    payments,
    adjustments,
    purchases,
    companions,
    usage,
    notes,
    jobs,
    audits,
  ] = await Promise.all([
    db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.workspaceMembers.role,
        lastSeenAt: schema.users.lastSeenAt,
        createdAt: schema.users.createdAt,
        suspendedAt: schema.users.suspendedAt,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.workspaceId, workspaceId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1),
    db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.workspaceId, workspaceId))
      .orderBy(desc(schema.payments.occurredAt))
      .limit(10),
    db
      .select()
      .from(schema.usageAdjustments)
      .where(eq(schema.usageAdjustments.workspaceId, workspaceId))
      .orderBy(desc(schema.usageAdjustments.createdAt)),
    db
      .select()
      .from(schema.usagePurchases)
      .where(eq(schema.usagePurchases.workspaceId, workspaceId)),
    db
      .select({
        id: schema.companions.id,
        name: schema.companions.name,
        slug: schema.companions.slug,
        status: schema.companions.status,
        fileCount: schema.companions.fileCount,
        questionCount: schema.companions.questionCount,
        viewCount: schema.companions.viewCount,
        storageBytes: schema.companions.storageBytes,
        createdAt: schema.companions.createdAt,
      })
      .from(schema.companions)
      .where(and(eq(schema.companions.workspaceId, workspaceId), isNull(schema.companions.deletedAt)))
      .orderBy(desc(schema.companions.createdAt))
      .limit(50),
    db
      .select({
        questions: sql<number>`count(*) FILTER (WHERE ${schema.usageLedger.billable})::int`,
        costUsd: sql<number>`coalesce(sum(${schema.usageLedger.estimatedCostUsd}), 0)::float8`,
        inputTokens: sql<number>`coalesce(sum(${schema.usageLedger.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${schema.usageLedger.outputTokens}), 0)::bigint`,
        errors: sql<number>`count(*) FILTER (WHERE NOT ${schema.usageLedger.succeeded})::int`,
      })
      .from(schema.usageLedger)
      .where(
        and(
          eq(schema.usageLedger.workspaceId, workspaceId),
          gte(schema.usageLedger.occurredAt, monthStart),
        ),
      ),
    db
      .select()
      .from(schema.adminNotes)
      .where(eq(schema.adminNotes.workspaceId, workspaceId))
      .orderBy(desc(schema.adminNotes.createdAt))
      .limit(20),
    db
      .select({
        id: schema.processingJobs.id,
        type: schema.processingJobs.type,
        status: schema.processingJobs.status,
        error: schema.processingJobs.error,
        createdAt: schema.processingJobs.createdAt,
        durationMs: schema.processingJobs.durationMs,
      })
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.workspaceId, workspaceId))
      .orderBy(desc(schema.processingJobs.createdAt))
      .limit(15),
    db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.workspaceId, workspaceId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(20),
  ]);

  const resolved = await resolveEntitlements({
    planKey: workspace.planKey,
    planOverrideKey: workspace.planOverrideKey,
    planOverrideExpiresAt: workspace.planOverrideExpiresAt,
    entitlementOverrides: workspace.entitlementOverrides,
  });

  const cycle =
    subscription[0]?.currentPeriodStart && subscription[0]?.currentPeriodEnd
      ? { start: subscription[0].currentPeriodStart, end: subscription[0].currentPeriodEnd }
      : calendarCycle(workspace.billingAnchorAt);

  const consumedRows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.usageLedger)
    .where(
      and(
        eq(schema.usageLedger.workspaceId, workspaceId),
        eq(schema.usageLedger.billable, true),
        gte(schema.usageLedger.occurredAt, cycle.start),
        sql`${schema.usageLedger.occurredAt} < ${ts(cycle.end)}`,
      ),
    );

  const activeAdjustments = adjustments
    .filter((adjustment) =>
      adjustmentAppliesToCycle(
        {
          createdAt: adjustment.createdAt,
          expiresAt: adjustment.expiresAt,
          recurring: adjustment.recurring,
        },
        cycle,
      ),
    )
    .reduce((total, adjustment) => total + adjustment.amount, 0);

  const purchasedTotal = purchases
    .filter((purchase) => purchase.expiresAt === null || purchase.expiresAt.getTime() > Date.now())
    .reduce((total, purchase) => total + purchase.questions, 0);

  const quota = computeQuotaState({
    planAllowance: resolved.entitlements.monthlyQuestions,
    purchased: purchasedTotal,
    adjustments: activeAdjustments,
    consumed: consumedRows[0]?.value ?? 0,
  });

  return {
    workspace,
    members,
    subscription: subscription[0] ?? null,
    payments,
    adjustments,
    purchases,
    companions,
    usage: usage[0] ?? null,
    notes,
    jobs,
    audits,
    entitlements: resolved,
    quota,
    cycle,
  };
}

/**
 * Grants or removes questions.
 *
 * Always an append to the adjustment ledger — consumed usage is never edited,
 * so history stays intact and the grant is fully attributable.
 */
export async function adjustQuota(input: {
  workspaceId: string;
  adminUserId: string;
  adminLabel: string;
  type: UsageAdjustmentType;
  amount: number;
  reason: string;
  expiresAt?: Date | null;
  recurring?: boolean;
}): Promise<void> {
  const { db } = getContainer();

  await db.insert(schema.usageAdjustments).values({
    workspaceId: input.workspaceId,
    type: input.type,
    amount: input.amount,
    reason: input.reason,
    createdByUserId: input.adminUserId,
    recurring: input.recurring ?? false,
    expiresAt: input.expiresAt ?? null,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.adminQuotaAdjusted,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: input.workspaceId,
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: {
      amount: input.amount,
      type: input.type,
      reason: input.reason,
      recurring: input.recurring ?? false,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });
}

/** Overrides the plan without touching the Stripe subscription. */
export async function overridePlan(input: {
  workspaceId: string;
  adminUserId: string;
  adminLabel: string;
  planKey: PlanKey;
  reason: string;
  expiresAt?: Date | null;
}): Promise<void> {
  const { db } = getContainer();

  await db
    .update(schema.workspaces)
    .set({
      planOverrideKey: input.planKey,
      planOverrideExpiresAt: input.expiresAt ?? null,
      planOverrideReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, input.workspaceId));

  invalidatePlanCache();

  await recordAudit({
    action: AUDIT_ACTIONS.adminPlanChanged,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: input.workspaceId,
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: {
      planKey: input.planKey,
      reason: input.reason,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
  });
}

export async function setWorkspaceStatus(input: {
  workspaceId: string;
  adminUserId: string;
  adminLabel: string;
  status: 'active' | 'suspended';
  reason: string;
}): Promise<void> {
  const { db } = getContainer();

  await db
    .update(schema.workspaces)
    .set({
      status: input.status,
      suspendedAt: input.status === 'suspended' ? new Date() : null,
      suspendedReason: input.status === 'suspended' ? input.reason : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, input.workspaceId));

  await recordAudit({
    action:
      input.status === 'suspended'
        ? AUDIT_ACTIONS.adminWorkspaceSuspended
        : AUDIT_ACTIONS.adminWorkspaceReactivated,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: input.workspaceId,
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: { reason: input.reason },
  });
}

export async function setWorkspaceSwitches(input: {
  workspaceId: string;
  adminUserId: string;
  adminLabel: string;
  uploadsDisabled?: boolean;
  aiDisabled?: boolean;
}): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.workspaces)
    .set({
      ...(input.uploadsDisabled !== undefined ? { uploadsDisabled: input.uploadsDisabled } : {}),
      ...(input.aiDisabled !== undefined ? { aiDisabled: input.aiDisabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, input.workspaceId));

  await recordAudit({
    action: 'admin.workspace_switches_changed',
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: input.workspaceId,
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: {
      uploadsDisabled: input.uploadsDisabled ?? null,
      aiDisabled: input.aiDisabled ?? null,
    },
  });
}

export async function addWorkspaceNote(input: {
  workspaceId: string;
  adminUserId: string;
  adminLabel: string;
  body: string;
}): Promise<void> {
  const { db } = getContainer();
  await db.insert(schema.adminNotes).values({
    workspaceId: input.workspaceId,
    authorUserId: input.adminUserId,
    authorLabel: input.adminLabel,
    body: input.body,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.adminNoteAdded,
    actorType: 'admin',
    actorUserId: input.adminUserId,
    actorLabel: input.adminLabel,
    workspaceId: input.workspaceId,
    targetType: 'workspace',
    targetId: input.workspaceId,
  });
}

export { COST_BASELINE, QUOTA_CONSUMING_STATUSES, inArray, invalidateLimitsCache };
