import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PlatformRole, WorkspaceRole, WorkspaceStatus } from '@companion/shared';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: varchar('email', { length: 254 }).notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    name: varchar('name', { length: 160 }),
    avatarUrl: text('avatar_url'),
    /** scrypt hash; null when the account only ever uses magic links or OAuth. */
    passwordHash: text('password_hash'),
    platformRole: varchar('platform_role', { length: 20 })
      .$type<PlatformRole>()
      .notNull()
      .default('user'),
    /** Google `sub`, when the account was linked through OAuth. */
    googleSubject: varchar('google_subject', { length: 128 }),
    lastSeenAt: ts('last_seen_at'),
    suspendedAt: ts('suspended_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(sql`lower(${table.email})`),
    uniqueIndex('users_google_subject_key').on(table.googleSubject),
    index('users_platform_role_idx').on(table.platformRole),
    index('users_created_at_idx').on(table.createdAt),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque cookie value; the raw token is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 400 }),
    /** Coarse location only; raw IP addresses are deliberately not retained. */
    ipHash: varchar('ip_hash', { length: 64 }),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_hash_key').on(table.tokenHash),
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 254 }).notNull(),
    purpose: varchar('purpose', { length: 32 })
      .$type<'magic_link' | 'email_verify' | 'password_reset'>()
      .notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** Opaque payload carried through the flow, e.g. an upload draft token. */
    payload: jsonb('payload').$type<Record<string, string>>(),
    consumedAt: ts('consumed_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('auth_tokens_hash_key').on(table.tokenHash),
    index('auth_tokens_email_idx').on(table.email),
    index('auth_tokens_expires_idx').on(table.expiresAt),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: primaryId(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    planKey: varchar('plan_key', { length: 32 }).notNull().default('free'),
    /** Admin-granted plan override that supersedes the subscription plan. */
    planOverrideKey: varchar('plan_override_key', { length: 32 }),
    planOverrideExpiresAt: ts('plan_override_expires_at'),
    planOverrideReason: varchar('plan_override_reason', { length: 500 }),
    /** Per-workspace entitlement overrides granted by an operator. */
    entitlementOverrides: jsonb('entitlement_overrides').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 20 }).$type<WorkspaceStatus>().notNull().default('active'),
    suspendedAt: ts('suspended_at'),
    suspendedReason: varchar('suspended_reason', { length: 500 }),
    uploadsDisabled: boolean('uploads_disabled').notNull().default(false),
    aiDisabled: boolean('ai_disabled').notNull().default(false),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    /** Day-of-month anchor for free workspaces without a Stripe period. */
    billingAnchorAt: ts('billing_anchor_at').notNull().default(sql`now()`),
    /** Denormalised counters refreshed by domain services; never the source of truth. */
    storageBytesUsed: integer('storage_bytes_used').notNull().default(0),
    branding: jsonb('branding').$type<Record<string, unknown>>(),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('workspaces_slug_key').on(table.slug),
    uniqueIndex('workspaces_stripe_customer_key').on(table.stripeCustomerId),
    index('workspaces_owner_idx').on(table.ownerId),
    index('workspaces_plan_idx').on(table.planKey),
    index('workspaces_status_idx').on(table.status),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).$type<WorkspaceRole>().notNull().default('member'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: ts('accepted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('workspace_members_unique').on(table.workspaceId, table.userId),
    index('workspace_members_user_idx').on(table.userId),
  ],
);
