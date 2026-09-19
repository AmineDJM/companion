import {
  DEFAULT_PLATFORM_LIMITS,
  PLAN_DEFINITIONS,
  type Entitlements,
  type EntitlementKey,
  type PlanKey,
  type PlatformLimits,
  entitlementOverrideSchema,
  isPlanKey,
  mergeEntitlements,
  platformLimitsSchema,
  AppError,
} from '@companion/shared';
import { eq, schema } from '@companion/db';
import { getContainer } from '../container';

/**
 * Entitlement resolution.
 *
 * Product code never branches on a plan key. It calls `resolveEntitlements` and
 * asks the returned object a question. The merge order is:
 *   plan defaults (code) -> plan record (admin-editable) -> workspace overrides
 * A workspace override always wins, because it is the most specific grant an
 * operator can make.
 */
export interface ResolvedEntitlements {
  planKey: PlanKey;
  /** The plan the subscription pays for, before any admin override. */
  basePlanKey: PlanKey;
  /** True when an operator override is currently in force. */
  overridden: boolean;
  overrideExpiresAt: Date | null;
  entitlements: Entitlements;
}

export interface WorkspaceEntitlementInput {
  planKey: string;
  planOverrideKey: string | null;
  planOverrideExpiresAt: Date | null;
  entitlementOverrides: Record<string, unknown> | null;
}

let planCache: { at: number; rows: Map<PlanKey, Entitlements> } | null = null;
const PLAN_CACHE_MS = 30_000;

async function loadPlanEntitlements(): Promise<Map<PlanKey, Entitlements>> {
  if (planCache && Date.now() - planCache.at < PLAN_CACHE_MS) return planCache.rows;
  const { db } = getContainer();
  const rows = await db.select().from(schema.plans);
  const map = new Map<PlanKey, Entitlements>();
  for (const row of rows) {
    if (isPlanKey(row.key)) map.set(row.key, row.entitlements);
  }
  planCache = { at: Date.now(), rows: map };
  return map;
}

/** Invalidated whenever an operator edits a plan in /admin. */
export function invalidatePlanCache(): void {
  planCache = null;
}

export async function resolveEntitlements(
  workspace: WorkspaceEntitlementInput,
  now: Date = new Date(),
): Promise<ResolvedEntitlements> {
  const basePlanKey: PlanKey = isPlanKey(workspace.planKey) ? workspace.planKey : 'free';

  const overrideActive =
    workspace.planOverrideKey !== null &&
    isPlanKey(workspace.planOverrideKey) &&
    (workspace.planOverrideExpiresAt === null ||
      workspace.planOverrideExpiresAt.getTime() > now.getTime());

  const planKey: PlanKey = overrideActive ? (workspace.planOverrideKey as PlanKey) : basePlanKey;

  const stored = await loadPlanEntitlements();
  const base = stored.get(planKey) ?? PLAN_DEFINITIONS[planKey].entitlements;

  const workspaceOverride = workspace.entitlementOverrides
    ? entitlementOverrideSchema.safeParse(workspace.entitlementOverrides)
    : null;

  return {
    planKey,
    basePlanKey,
    overridden: overrideActive,
    overrideExpiresAt: workspace.planOverrideExpiresAt,
    entitlements: mergeEntitlements(
      base,
      workspaceOverride?.success ? workspaceOverride.data : null,
    ),
  };
}

/** Throws a payment-required error naming the entitlement the plan lacks. */
export function requireEntitlement(
  entitlements: Entitlements,
  key: EntitlementKey,
  message: string,
): void {
  if (!entitlements[key]) {
    throw new AppError('entitlement_required', message, { details: { entitlement: key } });
  }
}

let limitsCache: { at: number; value: PlatformLimits } | null = null;
const LIMITS_CACHE_MS = 60_000;

/** Platform-wide technical caps, editable by a Super Admin at runtime. */
export async function platformLimits(): Promise<PlatformLimits> {
  if (limitsCache && Date.now() - limitsCache.at < LIMITS_CACHE_MS) return limitsCache.value;
  const { db } = getContainer();
  const rows = await db.select().from(schema.platformSettings).limit(1);
  const parsed = platformLimitsSchema.safeParse(rows[0]?.limits);
  const value = parsed.success ? parsed.data : DEFAULT_PLATFORM_LIMITS;
  limitsCache = { at: Date.now(), value };
  return value;
}

export function invalidateLimitsCache(): void {
  limitsCache = null;
}

/**
 * Effective upload ceiling: the smaller of the commercial entitlement and the
 * platform's technical cap. A plan can never raise a safety limit.
 */
export async function effectiveMaxUploadBytes(entitlements: Entitlements): Promise<number> {
  const limits = await platformLimits();
  return Math.min(entitlements.maxUploadBytes, limits.maxFileBytes);
}

export async function effectiveMaxFilesPerCompanion(entitlements: Entitlements): Promise<number> {
  const limits = await platformLimits();
  return Math.min(entitlements.maxFilesPerCompanion, limits.maxFilesPerCompanion);
}

/** Feature flags: global, per-plan or per-workspace. */
export async function isFeatureEnabled(
  key: string,
  context: { workspaceId?: string | null; planKey?: PlanKey | null },
): Promise<boolean> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.key, key))
    .limit(1);
  const flag = rows[0];
  if (!flag) return false;
  if (flag.enabledGlobally) return true;
  if (context.planKey && flag.enabledPlans.includes(context.planKey)) return true;
  if (context.workspaceId && flag.enabledWorkspaceIds.includes(context.workspaceId)) return true;
  return false;
}
