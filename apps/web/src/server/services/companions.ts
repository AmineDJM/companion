import {
  AppError,
  DEFAULT_BRANDING,
  derivedStatus,
  evaluateCompanionAvailability,
  generateSlug,
  resolveExpiration,
  type AccessMode,
  type Branding,
  type CompanionAccessState,
  type CompanionStatus,
  type SourceProtectionMode,
} from '@companion/shared';
import { and, asc, desc, eq, gte, inArray, isNull, or, schema, sql, type SQL } from '@companion/db';
import { getContainer } from '../container';
import { hashPassword } from '../crypto';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { assertCanCreateCompanion } from './quota';
import type { WorkspaceContext } from './workspace';

export interface CompanionRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: CompanionStatus;
  /** Status after applying the clock; expiry is derived, never written. */
  effectiveStatus: CompanionStatus;
  defaultFileId: string | null;
  downloadAllowed: boolean;
  aiEnabled: boolean;
  sourceProtectionMode: SourceProtectionMode;
  accessMode: AccessMode;
  expiresAt: Date | null;
  revokedAt: Date | null;
  pausedAt: Date | null;
  publishedAt: Date | null;
  branding: Branding;
  viewCount: number;
  visitorCount: number;
  questionCount: number;
  unansweredCount: number;
  fileCount: number;
  storageBytes: number;
  indexedUnits: number;
  indexedChunks: number;
  processingProgress: number;
  processingStep: string | null;
  processingError: string | null;
  lastOpenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: typeof schema.companions.$inferSelect): CompanionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    effectiveStatus: derivedStatus(row.status, row.expiresAt),
    defaultFileId: row.defaultFileId,
    downloadAllowed: row.downloadAllowed,
    aiEnabled: row.aiEnabled,
    sourceProtectionMode: row.sourceProtectionMode,
    accessMode: row.accessMode,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    pausedAt: row.pausedAt,
    publishedAt: row.publishedAt,
    branding: row.branding ?? DEFAULT_BRANDING,
    viewCount: row.viewCount,
    visitorCount: row.visitorCount,
    questionCount: row.questionCount,
    unansweredCount: row.unansweredCount,
    fileCount: row.fileCount,
    storageBytes: row.storageBytes,
    indexedUnits: row.indexedUnits,
    indexedChunks: row.indexedChunks,
    processingProgress: row.processingProgress,
    processingStep: row.processingStep,
    processingError: row.processingError,
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Allocates a unique public slug, retrying on the (rare) collision. */
export async function allocateSlug(): Promise<string> {
  const { db } = getContainer();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Widen the alphabet space once collisions start appearing.
    const slug = generateSlug(attempt < 4 ? 6 : 8);
    const existing = await db
      .select({ id: schema.companions.id })
      .from(schema.companions)
      .where(eq(schema.companions.slug, slug))
      .limit(1);
    if (existing.length === 0) return slug;
  }
  throw new AppError('internal_error', 'Could not allocate a share link. Try again.');
}

export async function createCompanion(input: {
  workspace: WorkspaceContext;
  userId: string;
  name?: string;
}): Promise<CompanionRecord> {
  await assertCanCreateCompanion(input.workspace.id, input.workspace.entitlements);

  const { db } = getContainer();
  const slug = await allocateSlug();
  const name = input.name?.trim() || 'Untitled Companion';

  const [row] = await db
    .insert(schema.companions)
    .values({
      workspaceId: input.workspace.id,
      createdByUserId: input.userId,
      name,
      slug,
      status: 'DRAFT',
      // View-only by default: the safe posture for confidential material.
      downloadAllowed: false,
      sourceProtectionMode: 'STANDARD',
      accessMode: 'PUBLIC',
      aiEnabled: true,
      branding: {
        ...DEFAULT_BRANDING,
        showCompanionBranding: !input.workspace.entitlements.removeBranding,
      },
    })
    .returning();
  if (!row) throw new AppError('internal_error', 'Could not create the Companion.');

  await db.insert(schema.companionAccessPolicies).values({ companionId: row.id });

  await recordAudit({
    action: AUDIT_ACTIONS.companionCreated,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.workspace.id,
    targetType: 'companion',
    targetId: row.id,
    targetLabel: name,
  });

  return toRecord(row);
}

export async function getCompanionById(
  companionId: string,
  workspaceId?: string,
): Promise<CompanionRecord | null> {
  const { db } = getContainer();
  const conditions: SQL[] = [
    eq(schema.companions.id, companionId),
    isNull(schema.companions.deletedAt),
  ];
  if (workspaceId) conditions.push(eq(schema.companions.workspaceId, workspaceId));
  const rows = await db
    .select()
    .from(schema.companions)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function getCompanionBySlug(slug: string): Promise<CompanionRecord | null> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.companions)
    .where(and(eq(schema.companions.slug, slug), isNull(schema.companions.deletedAt)))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Throws a 404 for a Companion that belongs to another workspace. */
export async function requireOwnedCompanion(
  companionId: string,
  workspaceId: string,
): Promise<CompanionRecord> {
  const companion = await getCompanionById(companionId, workspaceId);
  if (!companion) throw new AppError('not_found', 'Companion not found.');
  return companion;
}

export interface CompanionListFilters {
  q?: string;
  status?: CompanionStatus;
  sort?: 'updated' | 'created' | 'name' | 'views' | 'questions';
  page?: number;
  pageSize?: number;
}

export async function listCompanions(
  workspaceId: string,
  filters: CompanionListFilters = {},
): Promise<{ items: CompanionRecord[]; total: number }> {
  const { db } = getContainer();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  const conditions: SQL[] = [
    eq(schema.companions.workspaceId, workspaceId),
    isNull(schema.companions.deletedAt),
  ];
  if (filters.status) conditions.push(eq(schema.companions.status, filters.status));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const search = or(
      sql`${schema.companions.name} ILIKE ${pattern}`,
      sql`${schema.companions.slug} ILIKE ${pattern}`,
    );
    if (search) conditions.push(search);
  }

  const where = and(...conditions);
  const order = (() => {
    switch (filters.sort) {
      case 'created':
        return desc(schema.companions.createdAt);
      case 'name':
        return asc(schema.companions.name);
      case 'views':
        return desc(schema.companions.viewCount);
      case 'questions':
        return desc(schema.companions.questionCount);
      default:
        return desc(schema.companions.updatedAt);
    }
  })();

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(schema.companions)
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.companions).where(where),
  ]);

  return { items: rows.map(toRecord), total: countRows[0]?.value ?? 0 };
}

export interface AccessUpdate {
  accessMode?: AccessMode;
  password?: string | null;
  allowedEmails?: string[];
  allowedDomains?: string[];
  expirationPreset?: 'never' | '24h' | '7d' | '30d' | 'custom';
  expiresAt?: Date | null;
  downloadAllowed?: boolean;
  sourceProtectionMode?: SourceProtectionMode;
  aiEnabled?: boolean;
}

/**
 * Applies an access change. Every field is optional so the caller may change
 * one switch without restating the rest, and the public slug never changes.
 */
export async function updateAccess(input: {
  companion: CompanionRecord;
  workspace: WorkspaceContext;
  userId: string;
  update: AccessUpdate;
}): Promise<CompanionRecord> {
  const { db } = getContainer();
  const { update, companion, workspace } = input;
  const changes: Partial<typeof schema.companions.$inferInsert> = { updatedAt: new Date() };
  const auditMetadata: Record<string, unknown> = {};

  if (update.accessMode && update.accessMode !== companion.accessMode) {
    assertAccessModeAllowed(update.accessMode, workspace);
    changes.accessMode = update.accessMode;
    auditMetadata['accessMode'] = update.accessMode;
  }

  if (update.downloadAllowed !== undefined && update.downloadAllowed !== companion.downloadAllowed) {
    changes.downloadAllowed = update.downloadAllowed;
    auditMetadata['downloadAllowed'] = update.downloadAllowed;
  }

  if (update.aiEnabled !== undefined) changes.aiEnabled = update.aiEnabled;
  if (update.sourceProtectionMode) changes.sourceProtectionMode = update.sourceProtectionMode;

  if (update.expirationPreset) {
    if (update.expirationPreset === 'custom' && !workspace.entitlements.customExpiration) {
      throw new AppError(
        'entitlement_required',
        'Custom expiration dates are available on paid plans.',
        { details: { entitlement: 'customExpiration' } },
      );
    }
    const next = resolveExpiration(update.expirationPreset, update.expiresAt ?? null);
    changes.expiresAt = next;
    auditMetadata['expiresAt'] = next?.toISOString() ?? null;
    // Extending expiry on an expired Companion revives the same link.
    if (companion.status === 'EXPIRED' && (next === null || next.getTime() > Date.now())) {
      changes.status = 'ACTIVE';
    }
  }

  if (update.password !== undefined || update.allowedEmails || update.allowedDomains) {
    const policyChanges: Partial<typeof schema.companionAccessPolicies.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (update.password !== undefined) {
      if (update.password !== null && !workspace.entitlements.passwordProtection) {
        throw new AppError('entitlement_required', 'Password protection is available on paid plans.', {
          details: { entitlement: 'passwordProtection' },
        });
      }
      policyChanges.passwordHash = update.password ? await hashPassword(update.password) : null;
      auditMetadata['passwordSet'] = update.password !== null;
    }
    if (update.allowedEmails) policyChanges.allowedEmails = update.allowedEmails;
    if (update.allowedDomains) policyChanges.allowedDomains = update.allowedDomains;

    await db
      .update(schema.companionAccessPolicies)
      .set(policyChanges)
      .where(eq(schema.companionAccessPolicies.companionId, companion.id));
  }

  const [row] = await db
    .update(schema.companions)
    .set(changes)
    .where(eq(schema.companions.id, companion.id))
    .returning();
  if (!row) throw new AppError('not_found', 'Companion not found.');

  if (Object.keys(auditMetadata).length > 0) {
    await recordAudit({
      action: auditMetadata['downloadAllowed'] !== undefined
        ? AUDIT_ACTIONS.downloadToggled
        : AUDIT_ACTIONS.accessChanged,
      actorType: 'user',
      actorUserId: input.userId,
      workspaceId: workspace.id,
      targetType: 'companion',
      targetId: companion.id,
      targetLabel: companion.name,
      metadata: auditMetadata,
    });
  }

  return toRecord(row);
}

function assertAccessModeAllowed(mode: AccessMode, workspace: WorkspaceContext): void {
  if (mode === 'PASSWORD' && !workspace.entitlements.passwordProtection) {
    throw new AppError('entitlement_required', 'Password protection is available on paid plans.', {
      details: { entitlement: 'passwordProtection' },
    });
  }
  if (mode === 'EMAIL_LIST' && !workspace.entitlements.emailListAccess) {
    throw new AppError('entitlement_required', 'Sharing with specific people is available on paid plans.', {
      details: { entitlement: 'emailListAccess' },
    });
  }
  if (mode === 'IDENTIFIED' && !workspace.entitlements.identifiedAccess) {
    throw new AppError('entitlement_required', 'Identified access is available on the Business plan.', {
      details: { entitlement: 'identifiedAccess' },
    });
  }
}

export type LifecycleAction = 'pause' | 'reactivate' | 'revoke' | 'archive' | 'unarchive';

/**
 * Lifecycle transitions. Revocation is instant and reversible; nothing is
 * destroyed, so a sender can always bring a link back.
 */
export async function applyLifecycle(input: {
  companion: CompanionRecord;
  workspace: WorkspaceContext;
  userId: string;
  action: LifecycleAction;
  actorType?: 'user' | 'admin';
}): Promise<CompanionRecord> {
  const { db } = getContainer();
  const now = new Date();
  const changes: Partial<typeof schema.companions.$inferInsert> = { updatedAt: now };
  let action: string = AUDIT_ACTIONS.companionPaused;

  switch (input.action) {
    case 'pause':
      changes.status = 'PAUSED';
      changes.pausedAt = now;
      action = AUDIT_ACTIONS.companionPaused;
      break;
    case 'reactivate':
      // Re-entering ACTIVE must clear every block, or the link stays dead.
      changes.status = 'ACTIVE';
      changes.pausedAt = null;
      changes.revokedAt = null;
      changes.archivedAt = null;
      if (input.companion.expiresAt && input.companion.expiresAt.getTime() <= now.getTime()) {
        // Reactivating an expired Companion without a new date would be a no-op.
        changes.expiresAt = null;
      }
      action = AUDIT_ACTIONS.companionReactivated;
      break;
    case 'revoke':
      changes.status = 'REVOKED';
      changes.revokedAt = now;
      action = AUDIT_ACTIONS.companionRevoked;
      break;
    case 'archive':
      if (input.companion.status === 'PROCESSING') {
        throw new AppError('conflict', 'Wait for processing to finish before archiving.');
      }
      changes.status = 'ARCHIVED';
      changes.archivedAt = now;
      action = AUDIT_ACTIONS.companionArchived;
      break;
    case 'unarchive':
      await assertCanCreateCompanion(input.workspace.id, input.workspace.entitlements);
      changes.status = 'ACTIVE';
      changes.archivedAt = null;
      action = AUDIT_ACTIONS.companionReactivated;
      break;
  }

  const [row] = await db
    .update(schema.companions)
    .set(changes)
    .where(eq(schema.companions.id, input.companion.id))
    .returning();
  if (!row) throw new AppError('not_found', 'Companion not found.');

  await recordAudit({
    action,
    actorType: input.actorType ?? 'user',
    actorUserId: input.userId,
    workspaceId: input.workspace.id,
    targetType: 'companion',
    targetId: input.companion.id,
    targetLabel: input.companion.name,
  });

  return toRecord(row);
}

export async function renameCompanion(input: {
  companion: CompanionRecord;
  userId: string;
  name: string;
}): Promise<CompanionRecord> {
  const { db } = getContainer();
  const [row] = await db
    .update(schema.companions)
    .set({ name: input.name.trim(), updatedAt: new Date() })
    .where(eq(schema.companions.id, input.companion.id))
    .returning();
  if (!row) throw new AppError('not_found', 'Companion not found.');

  await recordAudit({
    action: AUDIT_ACTIONS.companionRenamed,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.companion.workspaceId,
    targetType: 'companion',
    targetId: input.companion.id,
    targetLabel: input.name,
  });
  return toRecord(row);
}

export async function setDefaultFile(companionId: string, fileId: string | null): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.companions)
    .set({ defaultFileId: fileId, updatedAt: new Date() })
    .where(eq(schema.companions.id, companionId));
}

export async function updateBranding(input: {
  companion: CompanionRecord;
  workspace: WorkspaceContext;
  userId: string;
  branding: Partial<Branding>;
}): Promise<CompanionRecord> {
  const { db } = getContainer();
  const next: Branding = { ...input.companion.branding, ...input.branding };

  if (!input.workspace.entitlements.removeBranding) next.showCompanionBranding = true;
  if (!input.workspace.entitlements.customBranding) {
    next.accentColor = null;
    next.logoUrl = null;
  }

  const [row] = await db
    .update(schema.companions)
    .set({ branding: next, updatedAt: new Date() })
    .where(eq(schema.companions.id, input.companion.id))
    .returning();
  if (!row) throw new AppError('not_found', 'Companion not found.');

  await recordAudit({
    action: AUDIT_ACTIONS.brandingChanged,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.workspace.id,
    targetType: 'companion',
    targetId: input.companion.id,
  });
  return toRecord(row);
}

/** Access state for the recipient policy evaluator. */
export async function loadAccessState(companion: CompanionRecord): Promise<CompanionAccessState> {
  const { db } = getContainer();
  const [policyRows, workspaceRows] = await Promise.all([
    db
      .select()
      .from(schema.companionAccessPolicies)
      .where(eq(schema.companionAccessPolicies.companionId, companion.id))
      .limit(1),
    db
      .select({ status: schema.workspaces.status })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, companion.workspaceId))
      .limit(1),
  ]);
  const policy = policyRows[0];

  return {
    status: companion.status,
    accessMode: companion.accessMode,
    expiresAt: companion.expiresAt,
    revokedAt: companion.revokedAt,
    pausedAt: companion.pausedAt,
    downloadAllowed: companion.downloadAllowed,
    aiEnabled: companion.aiEnabled,
    workspaceSuspended: workspaceRows[0]?.status === 'suspended',
    allowedEmails: policy?.allowedEmails ?? [],
    allowedDomains: policy?.allowedDomains ?? [],
  };
}

export async function loadPasswordHash(companionId: string): Promise<string | null> {
  const { db } = getContainer();
  const rows = await db
    .select({ passwordHash: schema.companionAccessPolicies.passwordHash })
    .from(schema.companionAccessPolicies)
    .where(eq(schema.companionAccessPolicies.companionId, companionId))
    .limit(1);
  return rows[0]?.passwordHash ?? null;
}

/** Quick availability probe used by the viewer before every protected action. */
export async function assertCompanionAvailable(companion: CompanionRecord): Promise<void> {
  const state = await loadAccessState(companion);
  const decision = evaluateCompanionAvailability(state);
  if (!decision.allowed) throw new AppError(decision.code, decision.message);
}

/** Soft-deletes and schedules the storage purge. Access stops immediately. */
export async function deleteCompanion(input: {
  companion: CompanionRecord;
  userId: string;
  retentionDays?: number;
}): Promise<void> {
  const { db, jobs } = getContainer();
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + (input.retentionDays ?? 7) * 24 * 60 * 60 * 1000);

  await db
    .update(schema.companions)
    .set({
      status: 'REVOKED',
      revokedAt: now,
      deletedAt: now,
      purgeAfterAt: purgeAfter,
      updatedAt: now,
    })
    .where(eq(schema.companions.id, input.companion.id));

  await recordAudit({
    action: AUDIT_ACTIONS.companionDeleted,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.companion.workspaceId,
    targetType: 'companion',
    targetId: input.companion.id,
    targetLabel: input.companion.name,
    metadata: { purgeAfter: purgeAfter.toISOString() },
  });

  if (jobs) {
    const idempotencyKey = `purge_companion:${input.companion.id}`;
    const [jobRecord] = await db
      .insert(schema.processingJobs)
      .values({
        companionId: input.companion.id,
        workspaceId: input.companion.workspaceId,
        type: 'purge_companion',
        idempotencyKey,
        status: 'QUEUED',
      })
      .onConflictDoNothing()
      .returning({ id: schema.processingJobs.id });

    if (jobRecord) {
      await jobs.enqueue(
        {
          type: 'purge_companion',
          jobRecordId: jobRecord.id,
          workspaceId: input.companion.workspaceId,
          companionId: input.companion.id,
          idempotencyKey,
        },
        { delayMs: (input.retentionDays ?? 7) * 24 * 60 * 60 * 1000 },
      );
    }
  }
}

/** Aggregate counters for the My Companions header. */
export async function workspaceCompanionSummary(workspaceId: string): Promise<{
  active: number;
  total: number;
  viewsThisMonth: number;
  questionsThisMonth: number;
}> {
  const { db } = getContainer();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [companionRows, eventRows] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*) FILTER (WHERE ${schema.companions.status} = 'ACTIVE')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.companions)
      .where(
        and(eq(schema.companions.workspaceId, workspaceId), isNull(schema.companions.deletedAt)),
      ),
    db
      .select({
        views: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} = 'companion_opened')::int`,
        questions: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} = 'question_asked')::int`,
      })
      .from(schema.analyticsEvents)
      .where(
        and(
          eq(schema.analyticsEvents.workspaceId, workspaceId),
          gte(schema.analyticsEvents.occurredAt, monthStart),
        ),
      ),
  ]);

  return {
    active: companionRows[0]?.active ?? 0,
    total: companionRows[0]?.total ?? 0,
    viewsThisMonth: eventRows[0]?.views ?? 0,
    questionsThisMonth: eventRows[0]?.questions ?? 0,
  };
}

/** Marks Companions whose expiry has passed, so the list view reads correctly. */
export async function sweepExpiredCompanions(): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .update(schema.companions)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(
      and(
        eq(schema.companions.status, 'ACTIVE'),
        sql`${schema.companions.expiresAt} IS NOT NULL`,
        sql`${schema.companions.expiresAt} <= now()`,
      ),
    )
    .returning({ id: schema.companions.id });
  return rows.length;
}

export { toRecord as toCompanionRecord, inArray };
