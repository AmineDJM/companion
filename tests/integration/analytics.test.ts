import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@companion/db';
import {
  createCompanion,
  createRecipientSession,
  createTenant,
  db,
  prepareDatabase,
  truncateAll,
  type CompanionFixture,
  type TenantFixture,
} from './helpers/db';

/**
 * Analytics durability and deduplication.
 *
 * Recording an event never throws, which is right — a reader must not see an
 * error because a counter could not be written — and is also why a broken
 * insert stayed invisible until the reconciliation metric noticed the
 * Companion's counters drifting away from its events. These tests assert the
 * row is actually there.
 */
const { recordAnalyticsEvent, companionOverview } = await import(
  '../../apps/web/src/server/services/analytics'
);

let sender: TenantFixture;
let companion: CompanionFixture;
let sessionId: string;

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  sender = await createTenant('analytics');
  companion = await createCompanion(sender);
  sessionId = await createRecipientSession(companion.id);
});

afterAll(async () => {
  await truncateAll();
});

async function eventsFor(companionId: string) {
  return db()
    .select()
    .from(schema.analyticsEvents)
    .where(eq(schema.analyticsEvents.companionId, companionId));
}

describe('recordAnalyticsEvent', () => {
  it('actually writes the row', async () => {
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'question_asked',
    });

    const rows = await eventsFor(companion.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('question_asked');
  });

  it('keys every event, including ones the caller did not key', async () => {
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'companion_opened',
    });

    const rows = await eventsFor(companion.id);
    // Without a key a row cannot be deduplicated at all, which is what the
    // analytics.duplicate_events metric counts.
    expect(rows[0]?.idempotencyKey).toBeTruthy();
  });

  it('records two genuine events in the same second as two events', async () => {
    for (let index = 0; index < 2; index += 1) {
      await recordAnalyticsEvent({
        companionId: companion.id,
        workspaceId: sender.workspaceId,
        recipientSessionId: sessionId,
        type: 'page_viewed',
        fileId: companion.fileId,
        page: 1,
      });
    }

    expect(await eventsFor(companion.id)).toHaveLength(2);
  });

  it('collapses a retried beacon that repeats its key', async () => {
    const key = `${sessionId}:beacon-1`;
    for (let index = 0; index < 3; index += 1) {
      await recordAnalyticsEvent({
        companionId: companion.id,
        workspaceId: sender.workspaceId,
        recipientSessionId: sessionId,
        type: 'page_viewed',
        fileId: companion.fileId,
        page: 1,
        durationMs: 4_000,
        idempotencyKey: key,
      });
    }

    expect(await eventsFor(companion.id)).toHaveLength(1);
  });

  it('never attributes an event to the wrong workspace', async () => {
    const other = await createTenant('other');
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'companion_opened',
    });

    const rows = await eventsFor(companion.id);
    expect(rows[0]?.workspaceId).toBe(sender.workspaceId);
    expect(rows[0]?.workspaceId).not.toBe(other.workspaceId);
  });
});

describe('companionOverview', () => {
  it('reports figures that reconcile with the events behind them', async () => {
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'companion_opened',
    });
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'question_asked',
    });
    await recordAnalyticsEvent({
      companionId: companion.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: sessionId,
      type: 'question_unanswered',
    });

    const overview = await companionOverview(companion.id);
    expect(overview.views).toBe(1);
    expect(overview.visitors).toBe(1);
    // questions counts both asked and unanswered, and unanswered is a subset.
    expect(overview.questions).toBe(2);
    expect(overview.unanswered).toBe(1);
  });

  it('counts nothing from another Companion', async () => {
    const other = await createCompanion(sender);
    const otherSession = await createRecipientSession(other.id);

    await recordAnalyticsEvent({
      companionId: other.id,
      workspaceId: sender.workspaceId,
      recipientSessionId: otherSession,
      type: 'companion_opened',
    });

    expect((await companionOverview(companion.id)).views).toBe(0);
    expect((await companionOverview(other.id)).views).toBe(1);
  });
});
