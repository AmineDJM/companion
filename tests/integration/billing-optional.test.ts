import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@companion/db';
import { createTenant, db, prepareDatabase, truncateAll, type TenantFixture } from './helpers/db';

/**
 * Billing is optional, and must stay that way.
 *
 * With no Stripe key the product simply has no billing: /pricing and /billing
 * do not exist, and nothing in the interface links to them. There is no broken
 * path for a customer to find, so readiness must not report a problem — a
 * permanent yellow row for a deliberate decision is how an operator learns to
 * stop reading the page.
 *
 * It stops being deliberate the moment money is involved. A live subscription
 * with no Stripe key means someone has paid for something this instance can no
 * longer renew, change or cancel, and its webhooks are being discarded. That
 * is CRITICAL, and it is the only thing that makes this check fail.
 */
const { productionReadiness } = await import('../../apps/web/src/server/services/readiness');
const { setEnvForTesting, loadEnv, billingEnabled } = await import(
  '../../apps/web/src/server/env'
);
const { getContainer } = await import('../../apps/web/src/server/container');

const ORIGINAL = { secretKey: process.env['STRIPE_SECRET_KEY'] };

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function withoutStripe(): void {
  delete process.env['STRIPE_SECRET_KEY'];
  setEnvForTesting(loadEnv(process.env));
  // The container is memoised for the process, so this asserts the state
  // rather than rebuilding it: the test environment never carries a Stripe
  // key, and a container that somehow held one would make every expectation
  // below meaningless.
  if (getContainer().stripe !== null) {
    throw new Error('the test container was built with Stripe configured');
  }
}

function billingCheckOf(report: Awaited<ReturnType<typeof productionReadiness>>) {
  const check = report.checks.find((entry) => entry.id === 'stripe');
  if (!check) throw new Error('readiness has no billing check');
  return check;
}

async function createSubscription(
  tenant: TenantFixture,
  status: (typeof schema.subscriptions.$inferInsert)['status'],
): Promise<void> {
  await db().insert(schema.subscriptions).values({
    workspaceId: tenant.workspaceId,
    planKey: 'pro',
    interval: 'monthly',
    status,
    amountCents: 2900,
    currency: 'eur',
  });
}

let sender: TenantFixture;

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  sender = await createTenant('billing-optional');
  withoutStripe();
});

afterAll(async () => {
  restore('STRIPE_SECRET_KEY', ORIGINAL.secretKey);
  setEnvForTesting(null);
  await truncateAll();
});

describe('an instance with no Stripe key', () => {
  it('reports billing as disabled, which is what hides every entry point', () => {
    expect(billingEnabled()).toBe(false);
  });

  it('passes readiness: there is nothing to sell and nothing to break', async () => {
    const check = billingCheckOf(await productionReadiness());

    expect(check.status).toBe('PASS');
    expect(check.detail).toContain('hides every path to it');
  });

  it('never makes billing a blocking failure on a fresh deploy', async () => {
    const report = await productionReadiness();
    const blocking = report.checks.filter((entry) => entry.status !== 'PASS');
    expect(blocking.map((entry) => entry.id)).not.toContain('stripe');
  });

  it('does not ask for a webhook secret or price ids it has no use for', async () => {
    const ids = (await productionReadiness()).checks.map((entry) => entry.id);
    expect(ids).not.toContain('stripe_webhook_secret');
    expect(ids.filter((id) => id.startsWith('stripe_price'))).toHaveLength(0);
  });
});

describe('when a live subscription depends on Stripe', () => {
  it('turns critical, because that customer can no longer be renewed or cancelled', async () => {
    await createSubscription(sender, 'active');

    const check = billingCheckOf(await productionReadiness());
    expect(check.status).toBe('CRITICAL');
    expect(check.detail).toContain('1 subscription');
    expect(check.remediation).toContain('STRIPE_SECRET_KEY');
  });

  it('counts a trialing subscription, which still converts to a charge', async () => {
    await createSubscription(sender, 'trialing');
    expect(billingCheckOf(await productionReadiness()).status).toBe('CRITICAL');
  });

  it('counts past_due, which is the case most in need of a working provider', async () => {
    await createSubscription(sender, 'past_due');
    expect(billingCheckOf(await productionReadiness()).status).toBe('CRITICAL');
  });

  it('ignores a cancelled subscription: history needs no payment provider', async () => {
    await createSubscription(sender, 'canceled');
    expect(billingCheckOf(await productionReadiness()).status).toBe('PASS');
  });

  it('ignores an incomplete subscription, which was never a charge', async () => {
    await createSubscription(sender, 'incomplete');
    expect(billingCheckOf(await productionReadiness()).status).toBe('PASS');
  });
});
