import { and, eq, isNull, lte, schema, sql } from '@companion/db';
import { container } from '../container.js';

/**
 * Periodic housekeeping.
 *
 * Small, idempotent tasks that keep the system honest: expiring links, freeing
 * storage, clearing dead sessions and refreshing the analytics rollups the
 * admin dashboards read.
 */
export async function runMaintenance(): Promise<void> {
  await Promise.allSettled([
    expireCompanions(),
    reclaimStorage(),
    purgeExpiredSessions(),
    purgeExpiredDrafts(),
    refreshDailyRollups(),
  ]);
}

/** Flips Companions whose expiry has passed so list views read correctly. */
async function expireCompanions(): Promise<void> {
  const { db } = container();
  await db
    .update(schema.companions)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(
      and(
        eq(schema.companions.status, 'ACTIVE'),
        sql`${schema.companions.expiresAt} IS NOT NULL`,
        sql`${schema.companions.expiresAt} <= now()`,
      ),
    );
}

/** Deletes storage objects whose retention window has elapsed. */
async function reclaimStorage(): Promise<void> {
  const { db, storage, logger } = container();
  const pending = await db
    .select()
    .from(schema.storageReclamations)
    .where(
      and(
        isNull(schema.storageReclamations.deletedAt),
        lte(schema.storageReclamations.deleteAfterAt, new Date()),
      ),
    )
    .limit(500);

  for (const row of pending) {
    try {
      await storage.delete(row.storageKey);
      await db
        .update(schema.storageReclamations)
        .set({ deletedAt: new Date(), error: null })
        .where(eq(schema.storageReclamations.id, row.id));
    } catch (error) {
      // Retried on the next pass; the row is never dropped silently.
      await db
        .update(schema.storageReclamations)
        .set({ error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' })
        .where(eq(schema.storageReclamations.id, row.id));
      logger.warn('storage reclamation failed', { key: row.storageKey });
    }
  }
}

async function purgeExpiredSessions(): Promise<void> {
  const { db } = container();
  await db
    .delete(schema.recipientSessions)
    .where(sql`${schema.recipientSessions.expiresAt} < now() - interval '30 days'`);
  await db
    .delete(schema.authSessions)
    .where(sql`${schema.authSessions.expiresAt} < now() - interval '7 days'`);
  await db.delete(schema.authTokens).where(sql`${schema.authTokens.expiresAt} < now() - interval '7 days'`);
}

async function purgeExpiredDrafts(): Promise<void> {
  const { db, storage } = container();
  const expired = await db
    .select()
    .from(schema.uploadDrafts)
    .where(and(isNull(schema.uploadDrafts.claimedAt), sql`${schema.uploadDrafts.expiresAt} <= now()`))
    .limit(100);

  for (const draft of expired) {
    await storage
      .deleteMany(draft.items.map((item) => item.storageKey))
      .catch(() => undefined);
    await db.delete(schema.uploadDrafts).where(eq(schema.uploadDrafts.id, draft.id));
  }
}

/**
 * Rolls the usage ledger up per day and workspace so /admin dashboards stay
 * fast as the ledger grows into millions of rows.
 */
async function refreshDailyRollups(): Promise<void> {
  const { db } = container();
  await db.execute(sql`
    INSERT INTO usage_daily_rollups (
      day, workspace_id, questions, answers, input_tokens, cached_input_tokens,
      output_tokens, answer_cost_usd, embedding_cost_usd, total_cost_usd, updated_at
    )
    SELECT
      to_char(occurred_at, 'YYYY-MM-DD') AS day,
      workspace_id,
      count(*) FILTER (WHERE billable)::int,
      count(*) FILTER (WHERE request_kind = 'answer' AND succeeded)::int,
      coalesce(sum(input_tokens), 0),
      coalesce(sum(cached_input_tokens), 0),
      coalesce(sum(output_tokens), 0),
      coalesce(sum(estimated_cost_usd) FILTER (WHERE request_kind = 'answer'), 0),
      coalesce(sum(estimated_cost_usd) FILTER (WHERE request_kind = 'embedding'), 0),
      coalesce(sum(estimated_cost_usd), 0),
      now()
    FROM usage_ledger
    WHERE occurred_at >= now() - interval '3 days'
      AND workspace_id IS NOT NULL
    GROUP BY 1, 2
    ON CONFLICT (day, workspace_id) DO UPDATE SET
      questions = EXCLUDED.questions,
      answers = EXCLUDED.answers,
      input_tokens = EXCLUDED.input_tokens,
      cached_input_tokens = EXCLUDED.cached_input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      answer_cost_usd = EXCLUDED.answer_cost_usd,
      embedding_cost_usd = EXCLUDED.embedding_cost_usd,
      total_cost_usd = EXCLUDED.total_cost_usd,
      updated_at = now()
  `);
}
