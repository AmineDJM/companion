import type { Entitlements, PlanKey } from '@companion/shared';
import { and, desc, eq, inArray, schema } from '@companion/db';
import { getContainer } from '../container';
import { resolveEntitlements, type ResolvedEntitlements } from './entitlements';
import type { WorkspaceQuotaContext } from './quota';

/**
 * A workspace plus everything a request needs to authorise and meter it.
 * Loaded once per request and threaded through the services.
 */
export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: 'active' | 'suspended';
  uploadsDisabled: boolean;
  aiDisabled: boolean;
  storageBytesUsed: number;
  stripeCustomerId: string | null;
  billingAnchorAt: Date;
  planKey: PlanKey;
  entitlements: Entitlements;
  resolved: ResolvedEntitlements;
  subscription: {
    id: string;
    status: string;
    interval: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeSubscriptionId: string | null;
  } | null;
}

export async function loadWorkspaceContext(workspaceId: string): Promise<WorkspaceContext | null> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const workspace = rows[0];
  if (!workspace || workspace.deletedAt) return null;

  const subscriptionRows = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.workspaceId, workspaceId),
        inArray(schema.subscriptions.status, ['active', 'trialing', 'past_due']),
      ),
    )
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);
  const subscription = subscriptionRows[0] ?? null;

  const resolved = await resolveEntitlements({
    planKey: workspace.planKey,
    planOverrideKey: workspace.planOverrideKey,
    planOverrideExpiresAt: workspace.planOverrideExpiresAt,
    entitlementOverrides: workspace.entitlementOverrides,
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerId: workspace.ownerId,
    status: workspace.status,
    uploadsDisabled: workspace.uploadsDisabled,
    aiDisabled: workspace.aiDisabled,
    storageBytesUsed: workspace.storageBytesUsed,
    stripeCustomerId: workspace.stripeCustomerId,
    billingAnchorAt: workspace.billingAnchorAt,
    planKey: resolved.planKey,
    entitlements: resolved.entitlements,
    resolved,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          interval: subscription.interval,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        }
      : null,
  };
}

export function quotaContextFor(workspace: WorkspaceContext): WorkspaceQuotaContext {
  return {
    workspaceId: workspace.id,
    billingAnchorAt: workspace.billingAnchorAt,
    entitlements: workspace.entitlements,
    periodStart: workspace.subscription?.currentPeriodStart ?? null,
    periodEnd: workspace.subscription?.currentPeriodEnd ?? null,
  };
}
