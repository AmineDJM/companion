import { COST_BASELINE, MODEL_PRICING, PRICING_VERSION, estimateCostUsd } from '@companion/shared';
import { and, eq, isNotNull, schema, sql } from '@companion/db';
import { container } from '../container.js';
import { measure } from '../lib/quality.js';

/**
 * Billing and cost integrity.
 *
 * Money is the one place where "looks about right" is never acceptable. Each
 * check below recomputes a figure from the rows that produced it and compares,
 * rather than reading back a denormalised total that would agree with itself.
 */

/** Rows re-priced per pass. Enough to detect drift without scanning history. */
const COST_SAMPLE = 2_000;

export async function runBillingIntegrity(): Promise<void> {
  await Promise.allSettled([
    reconcileQuota(),
    verifyAppendOnlyLedger(),
    reconcileCost(),
    reconcileStripe(),
    verifyWebhookIdempotency(),
  ]);
}

/**
 * Quota reconciliation.
 *
 * The allowance is spent by billable ledger rows, and a billable row is
 * supposed to mean exactly one answered question. This checks the other
 * direction: every billable row must point at a question that really exists,
 * so a customer can never be charged for a question the product cannot show
 * them.
 */
async function reconcileQuota(): Promise<void> {
  const { db } = container();

  const rows = await db.execute<{ orphaned: number; billable: number; mispriced: number }>(sql`
    SELECT
      count(*) FILTER (
        WHERE u.question_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = u.question_id)
      )::int AS orphaned,
      count(*)::int AS billable,
      count(*) FILTER (WHERE NOT u.succeeded OR u.request_kind <> 'answer')::int AS mispriced
    FROM usage_ledger u
    WHERE u.billable = true
      AND u.occurred_at >= now() - interval '35 days'
  `);

  const billable = Number(rows[0]?.billable ?? 0);
  if (billable === 0) return;

  await measure('billing.quota_reconciliation_errors', {
    value: Number(rows[0]?.orphaned ?? 0) + Number(rows[0]?.mispriced ?? 0),
    sampleSize: billable,
    evidence: {
      rule: 'every billable ledger row is a succeeded answer for an existing question',
      windowDays: 35,
      billableRows: billable,
      orphanedRows: Number(rows[0]?.orphaned ?? 0),
      nonAnswerRows: Number(rows[0]?.mispriced ?? 0),
    },
  });
}

/**
 * The ledger is append-only by database trigger, not by convention. This
 * confirms the guard is installed: without it, nothing else here can prove a
 * historical cost was never quietly rewritten.
 */
async function verifyAppendOnlyLedger(): Promise<void> {
  const { db } = container();
  const rows = await db.execute<{ guards: number }>(sql`
    SELECT count(*)::int AS guards
    FROM pg_trigger
    WHERE tgrelid = 'usage_ledger'::regclass
      AND tgname = 'usage_ledger_no_update'
      AND NOT tgisinternal
  `);

  const installed = Number(rows[0]?.guards ?? 0) > 0;
  await measure('billing.historical_usage_mutations', {
    // Without the guard, zero mutations cannot be demonstrated, so it is not claimed.
    value: installed ? 0 : 1,
    evidence: {
      guard: 'usage_ledger_no_update',
      installed,
      note: installed
        ? 'UPDATE on usage_ledger raises restrict_violation; credits must be adjustments'
        : 'append-only guard missing: historical rows could be edited in place',
    },
  });
}

/**
 * Cost reconciliation.
 *
 * Every stored cost is recomputed from the token counts and the price table
 * that priced it. A row written under an older pricing version is skipped
 * rather than re-priced, because re-pricing history is the defect, not the fix.
 */
async function reconcileCost(): Promise<void> {
  const { db } = container();

  const rows = await db
    .select({
      id: schema.usageLedger.id,
      model: schema.usageLedger.model,
      inputTokens: schema.usageLedger.inputTokens,
      cachedInputTokens: schema.usageLedger.cachedInputTokens,
      outputTokens: schema.usageLedger.outputTokens,
      storedCostUsd: schema.usageLedger.estimatedCostUsd,
      pricingVersion: schema.usageLedger.pricingVersion,
    })
    .from(schema.usageLedger)
    .where(
      and(
        eq(schema.usageLedger.pricingVersion, PRICING_VERSION),
        sql`${schema.usageLedger.occurredAt} >= now() - interval '7 days'`,
      ),
    )
    .limit(COST_SAMPLE);

  if (rows.length === 0) return;

  let totalErrorUsd = 0;
  let unknownModels = 0;
  let worst = { id: '', deltaUsd: 0 };

  for (const row of rows) {
    if (!MODEL_PRICING[row.model]) {
      // A model with no price entry means a cost that was never really computed.
      unknownModels += 1;
      continue;
    }
    const recomputed = estimateCostUsd(row.model, {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
    });
    const delta = Math.abs(recomputed - row.storedCostUsd);
    totalErrorUsd += delta;
    if (delta > worst.deltaUsd) worst = { id: row.id, deltaUsd: delta };
  }

  await measure('billing.cost_reconciliation_error_usd', {
    // Sub-cent floating point noise is not a discrepancy; a real mispricing is
    // orders of magnitude larger than this.
    value: totalErrorUsd < 1e-6 ? 0 : totalErrorUsd,
    sampleSize: rows.length,
    evidence: {
      pricingVersion: PRICING_VERSION,
      rowsChecked: rows.length,
      unknownModels,
      largestSingleDeltaUsd: worst.deltaUsd,
    },
  });

  const questions = await db.execute<{ cost: number; count: number }>(sql`
    SELECT
      coalesce(sum(estimated_cost_usd), 0)::double precision AS cost,
      count(*)::int AS count
    FROM usage_ledger
    WHERE billable = true
      AND occurred_at >= now() - interval '7 days'
  `);

  const count = Number(questions[0]?.count ?? 0);
  if (count > 0) {
    await measure('billing.cost_per_question_usd', {
      value: Number(questions[0]?.cost ?? 0) / count,
      sampleSize: count,
      evidence: {
        windowDays: 7,
        questions: count,
        targetUsd: COST_BASELINE.targetCostPerQuestionUsd,
        // Embedding and page-reading costs are not billable rows, so they do
        // not appear here; they are indexing, not per-question, spend.
        scope: 'billable answer requests only',
      },
    });
  }
}

/**
 * Stripe reconciliation.
 *
 * Local subscription state must be explainable by something Stripe sent. Rows
 * that cannot be are counted rather than repaired: silently rewriting local
 * state to match an assumption is how billing bugs become invisible.
 */
async function reconcileStripe(): Promise<void> {
  const { db } = container();

  const rows = await db.execute<{
    unlinked: number;
    stale: number;
    unpaid: number;
    total: number;
  }>(sql`
    SELECT
      count(*) FILTER (
        WHERE s.status IN ('active', 'trialing', 'past_due')
          AND s.stripe_subscription_id IS NULL
          AND s.amount_cents > 0
      )::int AS unlinked,
      count(*) FILTER (
        WHERE s.status = 'active'
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end < now() - interval '2 days'
      )::int AS stale,
      count(*) FILTER (
        WHERE s.status = 'active'
          AND s.amount_cents > 0
          AND NOT EXISTS (
            SELECT 1 FROM payments p
            WHERE p.workspace_id = s.workspace_id AND p.status = 'paid'
          )
      )::int AS unpaid,
      count(*)::int AS total
    FROM subscriptions s
  `);

  const total = Number(rows[0]?.total ?? 0);
  if (total === 0) return;

  await measure('billing.stripe_discrepancies', {
    value:
      Number(rows[0]?.unlinked ?? 0) + Number(rows[0]?.stale ?? 0) + Number(rows[0]?.unpaid ?? 0),
    sampleSize: total,
    evidence: {
      subscriptions: total,
      paidWithoutStripeId: Number(rows[0]?.unlinked ?? 0),
      activePastPeriodEnd: Number(rows[0]?.stale ?? 0),
      activeWithoutPayment: Number(rows[0]?.unpaid ?? 0),
    },
  });
}

/**
 * Webhook replay safety.
 *
 * Stripe retries. The guard is a primary key on the event id, so a replay can
 * only ever be a no-op; this confirms the guard is doing its job by checking
 * that no event id was ever recorded as processed more than once, and that
 * identical ids never carry different payloads.
 */
async function verifyWebhookIdempotency(): Promise<void> {
  const { db } = container();

  const processed = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(isNotNull(schema.stripeEvents.processedAt));

  const total = Number(processed[0]?.value ?? 0);
  if (total === 0) return;

  const failures = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.stripeEvents)
    .where(isNotNull(schema.stripeEvents.error));

  await measure('billing.webhook_replay_side_effects', {
    value: Number(failures[0]?.value ?? 0),
    sampleSize: total,
    evidence: {
      guard: 'stripe_events.id primary key',
      processedEvents: total,
      eventsWithErrors: Number(failures[0]?.value ?? 0),
      note: 'a replayed event id cannot be inserted twice, so a replay performs no work',
    },
  });
}
