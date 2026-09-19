import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getContainer } from '@/server/container';
import { env } from '@/server/env';
import {
  claimStripeEvent,
  markStripeEventProcessed,
  recordInvoice,
  syncSubscription,
} from '@/server/services/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook.
 *
 * The signature is verified against the raw body before anything is parsed —
 * an unverified payload is never trusted. Every event is claimed exactly once,
 * so Stripe's at-least-once delivery cannot double-apply a change.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { stripe, logger } = getContainer();
  const secret = env().STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) {
    logger.warn('stripe webhook received but billing is not configured');
    return NextResponse.json({ received: false }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    logger.warn('stripe signature verification failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const claimed = await claimStripeEvent(event);
  if (!claimed) {
    // Already handled; acknowledge so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const subscriptionId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await syncSubscription(event.data.object);
        break;

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.finalized':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await recordInvoice(event.data.object);
        break;

      default:
        // Unhandled types are acknowledged; the claim row records what arrived.
        break;
    }

    await markStripeEventProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await markStripeEventProcessed(event.id, message);
    logger.error('stripe webhook handler failed', { eventType: event.type, error });
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
