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
import type {
  BillingInterval,
  Entitlements,
  PlanKey,
  SubscriptionStatus,
  UsageAdjustmentType,
} from '@companion/shared';
import { createdAt, primaryId, ts, updatedAt } from './_shared.js';
import { users, workspaces } from './identity.js';

/**
 * Plans live in the database so a Super Admin can edit entitlements without a
 * deploy. Stripe price ids are stored alongside but monetary prices are never
 * mutated here — new prices require new Stripe Price objects, and existing
 * subscribers stay on their grandfathered price.
 */
export const plans = pgTable(
  'plans',
  {
    id: primaryId(),
    key: varchar('key', { length: 32 }).$type<PlanKey>().notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    tagline: varchar('tagline', { length: 300 }).notNull().default(''),
    monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
    annualPriceCents: integer('annual_price_cents').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('eur'),
    stripeProductId: varchar('stripe_product_id', { length: 64 }),
    stripeMonthlyPriceId: varchar('stripe_monthly_price_id', { length: 64 }),
    stripeAnnualPriceId: varchar('stripe_annual_price_id', { length: 64 }),
    entitlements: jsonb('entitlements').$type<Entitlements>().notNull(),
    highlights: jsonb('highlights').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('plans_key_key').on(table.key), index('plans_sort_idx').on(table.sortOrder)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planKey: varchar('plan_key', { length: 32 }).$type<PlanKey>().notNull(),
    interval: varchar('interval', { length: 16 }).$type<BillingInterval>().notNull(),
    status: varchar('status', { length: 32 }).$type<SubscriptionStatus>().notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 64 }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    stripePriceId: varchar('stripe_price_id', { length: 64 }),
    /** Booked value in minor units for MRR maths. Annual plans are divided by 12. */
    amountCents: integer('amount_cents').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('eur'),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: ts('canceled_at'),
    trialEndsAt: ts('trial_ends_at'),
    /** Extra days of service granted manually by an operator. */
    graceDays: integer('grace_days').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('subscriptions_stripe_key').on(table.stripeSubscriptionId),
    index('subscriptions_workspace_idx').on(table.workspaceId),
    index('subscriptions_status_idx').on(table.status),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    stripeInvoiceId: varchar('stripe_invoice_id', { length: 64 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 64 }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    amountDueCents: integer('amount_due_cents').notNull().default(0),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('eur'),
    status: varchar('status', { length: 32 })
      .$type<'paid' | 'open' | 'failed' | 'refunded' | 'void' | 'uncollectible' | 'pending'>()
      .notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    failureMessage: varchar('failure_message', { length: 500 }),
    nextRetryAt: ts('next_retry_at'),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    paidAt: ts('paid_at'),
    occurredAt: ts('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('payments_invoice_key').on(table.stripeInvoiceId),
    index('payments_workspace_idx').on(table.workspaceId),
    index('payments_status_idx').on(table.status),
    index('payments_occurred_idx').on(table.occurredAt),
  ],
);

/**
 * Ledger-style quota accounting. Question allowance is never a mutable integer:
 * it is the sum of a plan allowance plus these append-only rows.
 */
export const usageAdjustments = pgTable(
  'usage_adjustments',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<UsageAdjustmentType>().notNull(),
    /** Questions granted (positive) or withdrawn (negative). */
    amount: integer('amount').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** When true the grant repeats every billing cycle until it expires. */
    recurring: boolean('recurring').notNull().default(false),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('usage_adjustments_workspace_idx').on(table.workspaceId),
    index('usage_adjustments_created_idx').on(table.createdAt),
  ],
);

export const usagePurchases = pgTable(
  'usage_purchases',
  {
    id: primaryId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    packKey: varchar('pack_key', { length: 48 }).notNull(),
    questions: integer('questions').notNull(),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('eur'),
    stripeInvoiceId: varchar('stripe_invoice_id', { length: 64 }),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('usage_purchases_workspace_idx').on(table.workspaceId),
    index('usage_purchases_created_idx').on(table.createdAt),
  ],
);

/** Question packs available for purchase. Pricing is configuration, not code. */
export const usagePacks = pgTable(
  'usage_packs',
  {
    id: primaryId(),
    key: varchar('key', { length: 48 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    questions: integer('questions').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: varchar('currency', { length: 8 }).notNull().default('eur'),
    stripePriceId: varchar('stripe_price_id', { length: 64 }),
    /** Null means the pack never expires; otherwise days of validity. */
    validityDays: integer('validity_days'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('usage_packs_key_key').on(table.key)],
);

/** Idempotency guard so a replayed Stripe webhook is processed exactly once. */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    type: varchar('type', { length: 100 }).notNull(),
    processedAt: ts('processed_at'),
    error: text('error'),
    payloadDigest: varchar('payload_digest', { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [index('stripe_events_type_idx').on(table.type)],
);
