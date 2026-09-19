import {
  AppError,
  PLAN_DEFINITIONS,
  isFreePlan,
  isPlanKey,
  type BillingInterval,
  type PlanKey,
  type SubscriptionStatus,
} from '@companion/shared';
import { and, desc, eq, schema, sql } from '@companion/db';
import type Stripe from 'stripe';
import { getContainer } from '../container';
import { canonicalUrl } from '../env';
import { AUDIT_ACTIONS, recordAudit } from './audit';
import { invalidatePlanCache } from './entitlements';

/**
 * Stripe integration.
 *
 * Companion is an ordinary SaaS charging its own customers: no Connect, no
 * connected accounts. Stripe remains the source of truth for money; the
 * database holds a normalised mirror so the product can answer entitlement
 * questions without a network call on every request.
 */
function stripe(): Stripe {
  const { stripe: client } = getContainer();
  if (!client) {
    throw new AppError('provider_unavailable', 'Billing is not configured. Contact support.');
  }
  return client;
}

export async function ensureStripeCustomer(input: {
  workspaceId: string;
  workspaceName: string;
  email: string;
}): Promise<string> {
  const { db } = getContainer();
  const rows = await db
    .select({ id: schema.workspaces.stripeCustomerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);

  const existing = rows[0]?.id;
  if (existing) return existing;

  const customer = await stripe().customers.create({
    email: input.email,
    name: input.workspaceName,
    metadata: { workspaceId: input.workspaceId },
  });

  await db
    .update(schema.workspaces)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(schema.workspaces.id, input.workspaceId));

  return customer.id;
}

/** Looks up the Stripe price for a plan and interval from the plans table. */
async function priceIdFor(planKey: PlanKey, interval: BillingInterval): Promise<string> {
  const { db } = getContainer();
  const rows = await db.select().from(schema.plans).where(eq(schema.plans.key, planKey)).limit(1);
  const plan = rows[0];
  const priceId = interval === 'annual' ? plan?.stripeAnnualPriceId : plan?.stripeMonthlyPriceId;
  if (!priceId) {
    throw new AppError(
      'provider_unavailable',
      'This plan is not available for checkout yet. Contact support.',
      { details: { planKey, interval } },
    );
  }
  return priceId;
}

export async function createCheckoutSession(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  email: string;
  planKey: PlanKey;
  interval: BillingInterval;
}): Promise<string> {
  // The Free plan has no Stripe price object; this guards the checkout call
  // itself, it does not decide what the plan is allowed to do.
  if (isFreePlan(input.planKey)) {
    throw new AppError('validation_failed', 'The Free plan does not require checkout.');
  }

  const customerId = await ensureStripeCustomer(input);
  const priceId = await priceIdFor(input.planKey, input.interval);

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${canonicalUrl()}/billing?checkout=success`,
    cancel_url: `${canonicalUrl()}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    // Carried through to the webhook so the subscription lands on the right
    // workspace even if the customer record is shared or reassigned.
    subscription_data: {
      metadata: { workspaceId: input.workspaceId, planKey: input.planKey },
    },
    metadata: { workspaceId: input.workspaceId, planKey: input.planKey },
    client_reference_id: input.workspaceId,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.billingCheckoutStarted,
    actorType: 'user',
    actorUserId: input.userId,
    workspaceId: input.workspaceId,
    metadata: { planKey: input.planKey, interval: input.interval },
  });

  if (!session.url) throw new AppError('provider_unavailable', 'Could not start checkout.');
  return session.url;
}

export async function createPortalSession(workspaceId: string): Promise<string> {
  const { db } = getContainer();
  const rows = await db
    .select({ customerId: schema.workspaces.stripeCustomerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  const customerId = rows[0]?.customerId;
  if (!customerId) {
    throw new AppError('not_found', 'No billing account yet. Choose a plan first.');
  }

  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${canonicalUrl()}/billing`,
  });
  return session.url;
}

/**
 * Applies a Stripe subscription to the database.
 *
 * Idempotent: the same event may arrive twice, and the resulting state must be
 * identical. The workspace's plan key is derived from the subscription's price,
 * never from anything the client sent.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const { db, logger } = getContainer();

  const workspaceId = await resolveWorkspaceId(subscription);
  if (!workspaceId) {
    logger.warn('stripe subscription without a workspace', { subscriptionId: subscription.id });
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const planKey = await planForPrice(priceId);
  const interval: BillingInterval =
    item?.price.recurring?.interval === 'year' ? 'annual' : 'monthly';

  const amountCents = item?.price.unit_amount ?? 0;
  const status = subscription.status as SubscriptionStatus;
  const periodStart = item?.current_period_start ?? null;
  const periodEnd = item?.current_period_end ?? null;

  await db
    .insert(schema.subscriptions)
    .values({
      workspaceId,
      planKey,
      interval,
      status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripePriceId: priceId,
      amountCents,
      currency: item?.price.currency ?? 'eur',
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    })
    .onConflictDoUpdate({
      target: schema.subscriptions.stripeSubscriptionId,
      set: {
        planKey,
        interval,
        status,
        stripePriceId: priceId,
        amountCents,
        currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        updatedAt: new Date(),
      },
    });

  // A lapsed subscription drops the workspace to Free without destroying data:
  // existing Companions stay, new ones are simply refused.
  const entitledPlan: PlanKey =
    status === 'active' || status === 'trialing' || status === 'past_due' ? planKey : 'free';

  await db
    .update(schema.workspaces)
    .set({ planKey: entitledPlan, updatedAt: new Date() })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidatePlanCache();

  await recordAudit({
    action: AUDIT_ACTIONS.billingSubscriptionUpdated,
    actorType: 'stripe',
    workspaceId,
    targetType: 'subscription',
    targetId: subscription.id,
    metadata: { status, planKey: entitledPlan, interval },
  });
}

async function resolveWorkspaceId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.['workspaceId'];
  if (fromMetadata) return fromMetadata;

  const { db } = getContainer();
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const rows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.stripeCustomerId, customerId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function planForPrice(priceId: string | null): Promise<PlanKey> {
  if (!priceId) return 'free';
  const { db } = getContainer();
  const rows = await db
    .select({ key: schema.plans.key })
    .from(schema.plans)
    .where(
      sql`${schema.plans.stripeMonthlyPriceId} = ${priceId} OR ${schema.plans.stripeAnnualPriceId} = ${priceId}`,
    )
    .limit(1);
  const key = rows[0]?.key;
  return key && isPlanKey(key) ? key : 'free';
}

/** Records an invoice, paid or failed, for the admin revenue views. */
export async function recordInvoice(invoice: Stripe.Invoice): Promise<void> {
  const { db } = getContainer();
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const workspaceRows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.stripeCustomerId, customerId))
    .limit(1);
  const workspaceId = workspaceRows[0]?.id ?? null;

  const subscriptionRows = workspaceId
    ? await db
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.workspaceId, workspaceId))
        .orderBy(desc(schema.subscriptions.createdAt))
        .limit(1)
    : [];

  const status = mapInvoiceStatus(invoice);

  await db
    .insert(schema.payments)
    .values({
      workspaceId,
      subscriptionId: subscriptionRows[0]?.id ?? null,
      stripeInvoiceId: invoice.id ?? null,
      stripeCustomerId: customerId,
      amountDueCents: invoice.amount_due ?? 0,
      amountPaidCents: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? 'eur',
      status,
      attemptCount: invoice.attempt_count ?? 0,
      failureMessage: invoice.last_finalization_error?.message?.slice(0, 500) ?? null,
      nextRetryAt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      paidAt: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : null,
      occurredAt: new Date((invoice.created ?? Math.floor(Date.now() / 1000)) * 1000),
    })
    .onConflictDoUpdate({
      target: schema.payments.stripeInvoiceId,
      set: {
        status,
        amountPaidCents: invoice.amount_paid ?? 0,
        attemptCount: invoice.attempt_count ?? 0,
        failureMessage: invoice.last_finalization_error?.message?.slice(0, 500) ?? null,
        nextRetryAt: invoice.next_payment_attempt
          ? new Date(invoice.next_payment_attempt * 1000)
          : null,
        paidAt: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : null,
      },
    });

  await recordAudit({
    action: AUDIT_ACTIONS.billingPaymentRecorded,
    actorType: 'stripe',
    workspaceId,
    targetType: 'invoice',
    targetId: invoice.id ?? null,
    metadata: { status, amountPaidCents: invoice.amount_paid ?? 0 },
  });
}

function mapInvoiceStatus(
  invoice: Stripe.Invoice,
): 'paid' | 'open' | 'failed' | 'refunded' | 'void' | 'uncollectible' | 'pending' {
  if (invoice.status === 'paid') return 'paid';
  if (invoice.status === 'void') return 'void';
  if (invoice.status === 'uncollectible') return 'uncollectible';
  if (invoice.status === 'draft') return 'pending';
  // An open invoice that has already been attempted is a failed payment.
  if (invoice.status === 'open') return (invoice.attempt_count ?? 0) > 0 ? 'failed' : 'open';
  return 'pending';
}

/**
 * Webhook idempotency. Returns false when this event was already processed, so
 * a Stripe retry can never double-apply a state change.
 */
export async function claimStripeEvent(event: Stripe.Event): Promise<boolean> {
  const { db } = getContainer();
  const rows = await db
    .insert(schema.stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.stripeEvents.id });
  return rows.length > 0;
}

export async function markStripeEventProcessed(eventId: string, error?: string): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.stripeEvents)
    .set({ processedAt: new Date(), error: error ?? null })
    .where(eq(schema.stripeEvents.id, eventId));
}

/** Monthly recurring revenue, in cents. Annual plans are amortised over twelve. */
export async function monthlyRecurringRevenueCents(): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .select({
      value: sql<number>`coalesce(sum(
        CASE WHEN ${schema.subscriptions.interval} = 'annual'
          THEN ${schema.subscriptions.amountCents} / 12.0
          ELSE ${schema.subscriptions.amountCents}
        END
      ), 0)::float8`,
    })
    .from(schema.subscriptions)
    .where(
      and(
        sql`${schema.subscriptions.status} IN ('active', 'trialing')`,
        eq(schema.subscriptions.cancelAtPeriodEnd, false),
      ),
    );
  return Math.round(rows[0]?.value ?? 0);
}

export { PLAN_DEFINITIONS };
