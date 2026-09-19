import type { AnalyticsEventType } from '@companion/shared';
import { and, desc, eq, gte, isNull, schema, sql } from '@companion/db';
import { unansweredInsight } from '@companion/ai';
import { getContainer } from '../container';

/**
 * Analytics.
 *
 * Aggregated and anonymous by default. Nothing here identifies a visitor unless
 * the sender explicitly enabled identified access and the recipient confirmed
 * an email. No fingerprinting, and raw IP addresses are never stored.
 */
export interface AnalyticsEventInput {
  companionId: string;
  workspaceId: string;
  recipientSessionId?: string | null;
  type: AnalyticsEventType;
  fileId?: string | null;
  page?: number | null;
  durationMs?: number | null;
  metadata?: Record<string, string | number | boolean> | null;
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput): Promise<void> {
  const { db, logger } = getContainer();
  try {
    await db.insert(schema.analyticsEvents).values({
      companionId: input.companionId,
      workspaceId: input.workspaceId,
      recipientSessionId: input.recipientSessionId ?? null,
      type: input.type,
      fileId: input.fileId ?? null,
      page: input.page ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? null,
      occurredAt: new Date(),
    });
  } catch (error) {
    // Analytics must never break the recipient experience.
    logger.warn('analytics event dropped', { type: input.type, error });
  }
}

/** Records an open and keeps the Companion's denormalised counters current. */
export async function recordCompanionOpen(input: {
  companionId: string;
  workspaceId: string;
  recipientSessionId: string;
  isNewVisitor: boolean;
}): Promise<void> {
  const { db } = getContainer();
  await db
    .update(schema.companions)
    .set({
      viewCount: sql`${schema.companions.viewCount} + 1`,
      visitorCount: input.isNewVisitor
        ? sql`${schema.companions.visitorCount} + 1`
        : sql`${schema.companions.visitorCount}`,
      lastOpenedAt: new Date(),
    })
    .where(eq(schema.companions.id, input.companionId));

  await db
    .update(schema.recipientSessions)
    .set({ viewCount: sql`${schema.recipientSessions.viewCount} + 1`, lastSeenAt: new Date() })
    .where(eq(schema.recipientSessions.id, input.recipientSessionId));

  await recordAnalyticsEvent({
    companionId: input.companionId,
    workspaceId: input.workspaceId,
    recipientSessionId: input.recipientSessionId,
    type: 'companion_opened',
  });
}

export interface AnalyticsOverview {
  views: number;
  visitors: number;
  questions: number;
  questionsPerVisitor: number;
  unanswered: number;
  downloads: number;
  averageTimeSeconds: number;
}

export async function companionOverview(
  companionId: string,
  since?: Date,
): Promise<AnalyticsOverview> {
  const { db } = getContainer();
  const conditions = [eq(schema.analyticsEvents.companionId, companionId)];
  if (since) conditions.push(gte(schema.analyticsEvents.occurredAt, since));

  const rows = await db
    .select({
      views: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} = 'companion_opened')::int`,
      visitors: sql<number>`count(DISTINCT ${schema.analyticsEvents.recipientSessionId})::int`,
      questions: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} IN ('question_asked','question_unanswered'))::int`,
      unanswered: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} = 'question_unanswered')::int`,
      downloads: sql<number>`count(*) FILTER (WHERE ${schema.analyticsEvents.type} = 'download_clicked')::int`,
      dwellMs: sql<number>`coalesce(sum(${schema.analyticsEvents.durationMs}), 0)::bigint`,
    })
    .from(schema.analyticsEvents)
    .where(and(...conditions));

  const row = rows[0];
  const visitors = row?.visitors ?? 0;
  const questions = row?.questions ?? 0;
  return {
    views: row?.views ?? 0,
    visitors,
    questions,
    questionsPerVisitor: visitors > 0 ? Number((questions / visitors).toFixed(1)) : 0,
    unanswered: row?.unanswered ?? 0,
    downloads: row?.downloads ?? 0,
    averageTimeSeconds:
      visitors > 0 ? Math.round(Number(row?.dwellMs ?? 0) / 1000 / visitors) : 0,
  };
}

export interface TopicSummary {
  label: string;
  slug: string;
  questionCount: number;
  unansweredCount: number;
  exampleQuestions: string[];
  insight: string | null;
}

export async function companionTopics(companionId: string, limit = 8): Promise<TopicSummary[]> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.questionTopics)
    .where(eq(schema.questionTopics.companionId, companionId))
    .orderBy(desc(schema.questionTopics.questionCount))
    .limit(limit);

  return rows.map((row) => ({
    label: row.label,
    slug: row.slug,
    questionCount: row.questionCount,
    unansweredCount: row.unansweredCount,
    exampleQuestions: row.exampleQuestions,
    insight:
      row.insight ??
      unansweredInsight({
        label: row.label,
        questionCount: row.questionCount,
        unansweredCount: row.unansweredCount,
        exampleQuestions: row.exampleQuestions,
      }),
  }));
}

export interface FileEngagement {
  fileId: string;
  fileName: string;
  opens: number;
  citations: number;
  averageSeconds: number;
}

export async function mostConsultedFiles(
  companionId: string,
  limit = 6,
): Promise<FileEngagement[]> {
  const { db } = getContainer();
  const rows = await db
    .select({
      fileId: schema.files.id,
      fileName: schema.files.name,
      opens: sql<number>`count(${schema.analyticsEvents.id}) FILTER (WHERE ${schema.analyticsEvents.type} = 'file_opened')::int`,
      dwellMs: sql<number>`coalesce(sum(${schema.analyticsEvents.durationMs}), 0)::bigint`,
      sessions: sql<number>`count(DISTINCT ${schema.analyticsEvents.recipientSessionId})::int`,
    })
    .from(schema.files)
    .leftJoin(schema.analyticsEvents, eq(schema.analyticsEvents.fileId, schema.files.id))
    .where(and(eq(schema.files.companionId, companionId), isNull(schema.files.removedAt)))
    .groupBy(schema.files.id, schema.files.name)
    .orderBy(sql`count(${schema.analyticsEvents.id}) DESC`)
    .limit(limit);

  const citationRows = await db
    .select({
      fileId: schema.citations.fileId,
      value: sql<number>`count(*)::int`,
    })
    .from(schema.citations)
    .where(eq(schema.citations.companionId, companionId))
    .groupBy(schema.citations.fileId);
  const citationsByFile = new Map(citationRows.map((row) => [row.fileId, row.value]));

  return rows.map((row) => ({
    fileId: row.fileId,
    fileName: row.fileName,
    opens: row.opens,
    citations: citationsByFile.get(row.fileId) ?? 0,
    averageSeconds: row.sessions > 0 ? Math.round(Number(row.dwellMs) / 1000 / row.sessions) : 0,
  }));
}

export interface PageEngagement {
  fileId: string;
  fileName: string;
  page: number;
  views: number;
  averageSeconds: number;
}

export async function mostViewedPages(companionId: string, limit = 8): Promise<PageEngagement[]> {
  const { db } = getContainer();
  const rows = await db
    .select({
      fileId: schema.analyticsEvents.fileId,
      fileName: schema.files.name,
      page: schema.analyticsEvents.page,
      views: sql<number>`count(*)::int`,
      dwellMs: sql<number>`coalesce(sum(${schema.analyticsEvents.durationMs}), 0)::bigint`,
    })
    .from(schema.analyticsEvents)
    .innerJoin(schema.files, eq(schema.files.id, schema.analyticsEvents.fileId))
    .where(
      and(
        eq(schema.analyticsEvents.companionId, companionId),
        eq(schema.analyticsEvents.type, 'page_viewed'),
        sql`${schema.analyticsEvents.page} IS NOT NULL`,
      ),
    )
    .groupBy(schema.analyticsEvents.fileId, schema.files.name, schema.analyticsEvents.page)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  return rows
    .filter((row): row is typeof row & { fileId: string; page: number } =>
      row.fileId !== null && row.page !== null,
    )
    .map((row) => ({
      fileId: row.fileId,
      fileName: row.fileName,
      page: row.page,
      views: row.views,
      averageSeconds: row.views > 0 ? Math.round(Number(row.dwellMs) / 1000 / row.views) : 0,
    }));
}

export interface UnansweredQuestion {
  id: string;
  text: string;
  askedAt: Date;
  topicLabel: string | null;
}

export async function unansweredQuestions(
  companionId: string,
  limit = 20,
): Promise<UnansweredQuestion[]> {
  const { db } = getContainer();
  const rows = await db
    .select({
      id: schema.questions.id,
      text: schema.questions.text,
      askedAt: schema.questions.createdAt,
      topicLabel: schema.questionTopics.label,
    })
    .from(schema.questions)
    .innerJoin(schema.answers, eq(schema.answers.questionId, schema.questions.id))
    .leftJoin(schema.questionTopics, eq(schema.questionTopics.id, schema.questions.topicId))
    .where(
      and(
        eq(schema.questions.companionId, companionId),
        eq(schema.answers.answered, false),
        eq(schema.questions.blockedByProtection, false),
      ),
    )
    .orderBy(desc(schema.questions.createdAt))
    .limit(limit);
  return rows;
}

export interface ActivityEntry {
  type: AnalyticsEventType;
  occurredAt: Date;
  fileName: string | null;
  page: number | null;
}

export async function recentActivity(companionId: string, limit = 12): Promise<ActivityEntry[]> {
  const { db } = getContainer();
  const rows = await db
    .select({
      type: schema.analyticsEvents.type,
      occurredAt: schema.analyticsEvents.occurredAt,
      fileName: schema.files.name,
      page: schema.analyticsEvents.page,
    })
    .from(schema.analyticsEvents)
    .leftJoin(schema.files, eq(schema.files.id, schema.analyticsEvents.fileId))
    .where(eq(schema.analyticsEvents.companionId, companionId))
    .orderBy(desc(schema.analyticsEvents.occurredAt))
    .limit(limit);
  return rows;
}

/** Recent questions with their answer status, for the Overview tab. */
export async function recentQuestions(
  companionId: string,
  limit = 10,
): Promise<{ id: string; text: string; answered: boolean; askedAt: Date }[]> {
  const { db } = getContainer();
  return db
    .select({
      id: schema.questions.id,
      text: schema.questions.text,
      answered: sql<boolean>`coalesce(${schema.answers.answered}, false)`,
      askedAt: schema.questions.createdAt,
    })
    .from(schema.questions)
    .leftJoin(schema.answers, eq(schema.answers.questionId, schema.questions.id))
    .where(eq(schema.questions.companionId, companionId))
    .orderBy(desc(schema.questions.createdAt))
    .limit(limit);
}

/** Daily views/questions series for the analytics chart. */
export async function dailySeries(
  companionId: string,
  days = 30,
): Promise<{ day: string; views: number; questions: number }[]> {
  const { db } = getContainer();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{ day: string; views: number; questions: number }>(sql`
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      coalesce(count(e.id) FILTER (WHERE e.type = 'companion_opened'), 0)::int AS views,
      coalesce(count(e.id) FILTER (WHERE e.type IN ('question_asked','question_unanswered')), 0)::int AS questions
    FROM generate_series(${since}::date, now()::date, '1 day') AS d(day)
    LEFT JOIN analytics_events e
      ON e.companion_id = ${companionId}
     AND e.occurred_at >= d.day
     AND e.occurred_at < d.day + interval '1 day'
    GROUP BY d.day
    ORDER BY d.day
  `);
  return [...rows];
}

/** Identified visitors. Only ever populated when identified access is on. */
export async function identifiedVisitors(
  companionId: string,
  limit = 50,
): Promise<{ email: string; visitCount: number; lastSeenAt: Date; questionCount: number }[]> {
  const { db } = getContainer();
  return db
    .select({
      email: schema.recipientIdentities.email,
      visitCount: schema.recipientIdentities.visitCount,
      lastSeenAt: schema.recipientIdentities.lastSeenAt,
      questionCount: sql<number>`coalesce((
        SELECT count(*)::int FROM ${schema.recipientSessions} rs
        WHERE rs.identity_id = ${schema.recipientIdentities.id}
      ), 0)`,
    })
    .from(schema.recipientIdentities)
    .where(
      and(
        eq(schema.recipientIdentities.companionId, companionId),
        sql`${schema.recipientIdentities.verifiedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(schema.recipientIdentities.lastSeenAt))
    .limit(limit);
}
