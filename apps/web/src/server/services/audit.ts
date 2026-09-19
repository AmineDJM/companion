import { schema } from '@companion/db';
import { getContainer } from '../container';

/**
 * Immutable operational trail.
 *
 * Every state change a customer or operator makes is recorded. Metadata is
 * structured context only — document contents are never written here.
 */
export interface AuditInput {
  action: string;
  actorType: 'user' | 'admin' | 'system' | 'stripe';
  actorUserId?: string | null;
  actorLabel?: string | null;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const { db, logger } = getContainer();
  try {
    await db.insert(schema.auditLogs).values({
      action: input.action,
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel ?? null,
      workspaceId: input.workspaceId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    // An audit write must never fail the operation it is recording, but a
    // silent loss would be worse — so it is logged at error level.
    logger.error('audit write failed', { action: input.action, error });
  }
}

/** Actions the sender performs on their own Companions. */
export const AUDIT_ACTIONS = {
  companionCreated: 'companion.created',
  companionRenamed: 'companion.renamed',
  companionPublished: 'companion.published',
  companionPaused: 'companion.paused',
  companionReactivated: 'companion.reactivated',
  companionRevoked: 'companion.revoked',
  companionArchived: 'companion.archived',
  companionDeleted: 'companion.deleted',
  fileAdded: 'companion.file_added',
  fileRemoved: 'companion.file_removed',
  fileReplaced: 'companion.file_replaced',
  accessChanged: 'companion.access_changed',
  downloadToggled: 'companion.download_toggled',
  expirationExtended: 'companion.expiration_extended',
  passwordChanged: 'companion.password_changed',
  domainChanged: 'companion.domain_changed',
  brandingChanged: 'companion.branding_changed',

  adminPlanChanged: 'admin.plan_changed',
  adminQuotaAdjusted: 'admin.quota_adjusted',
  adminWorkspaceSuspended: 'admin.workspace_suspended',
  adminWorkspaceReactivated: 'admin.workspace_reactivated',
  adminJobRetried: 'admin.job_retried',
  adminFeatureFlagChanged: 'admin.feature_flag_changed',
  adminPlanEntitlementsChanged: 'admin.plan_entitlements_changed',
  adminLimitsChanged: 'admin.limits_changed',
  adminCompanionAction: 'admin.companion_action',
  adminNoteAdded: 'admin.note_added',
  adminContentInspected: 'admin.content_inspected',

  billingSubscriptionUpdated: 'billing.subscription_updated',
  billingPaymentRecorded: 'billing.payment_recorded',
  billingCheckoutStarted: 'billing.checkout_started',
} as const;
