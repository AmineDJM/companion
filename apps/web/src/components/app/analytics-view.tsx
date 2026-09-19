import Link from 'next/link';
import { formatRelativeTime, type AnalyticsLevel } from '@companion/shared';
import { Card, EmptyState, SectionHeading, Stat, StatRow } from '../ui/primitives';

/**
 * Companion analytics.
 *
 * Deliberately not a web-analytics dashboard: the question is "what did people
 * want to know, and did the documents answer it?" — not sessions and bounce rate.
 */
export interface AnalyticsViewProps {
  level: AnalyticsLevel;
  overview: {
    views: number;
    visitors: number;
    questions: number;
    questionsPerVisitor: number;
    unanswered: number;
    downloads: number;
    averageTimeSeconds: number;
  };
  topics: {
    label: string;
    slug: string;
    questionCount: number;
    unansweredCount: number;
    insight: string | null;
  }[];
  files: { fileId: string; fileName: string; opens: number; citations: number; averageSeconds: number }[];
  pages: { fileId: string; fileName: string; page: number; views: number; averageSeconds: number }[];
  unanswered: { id: string; text: string; askedAt: string; topicLabel: string | null }[];
  series: { day: string; views: number; questions: number }[];
  visitors: { email: string; visitCount: number; lastSeenAt: string }[];
}

export function AnalyticsView({
  level,
  overview,
  topics,
  files,
  pages,
  unanswered,
  series,
  visitors,
}: AnalyticsViewProps) {
  const hasActivity = overview.views > 0 || overview.questions > 0;

  if (!hasActivity) {
    return (
      <EmptyState
        title="No activity yet"
        description="Insights will appear after people begin opening your Companion."
      />
    );
  }

  const maxTopic = Math.max(...topics.map((topic) => topic.questionCount), 1);

  return (
    <div className="space-y-6">
      <Card>
        <StatRow>
          <Stat label="Views" value={overview.views} />
          <Stat label="Visitors" value={overview.visitors} />
          <Stat label="Questions" value={overview.questions} />
          <Stat label="Questions / visitor" value={overview.questionsPerVisitor.toFixed(1)} />
        </StatRow>
      </Card>

      {series.length > 0 ? (
        <Card>
          <SectionHeading title="Last 30 days" />
          <ActivityChart series={series} />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading title="What people want to know" />
          {topics.length === 0 ? (
            <p className="mt-4 text-[13.5px] text-ink-muted">No questions yet.</p>
          ) : (
            <ul className="mt-5 space-y-3.5">
              {topics.map((topic) => (
                <li key={topic.slug}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13.5px] text-ink">{topic.label}</span>
                    <span className="shrink-0 text-[13.5px] tabular-nums text-ink-muted">
                      {topic.questionCount}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(topic.questionCount / maxTopic) * 100}%` }}
                    />
                  </div>
                  {topic.insight ? (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-warning">
                      {topic.insight}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading title="Most consulted" />
          {files.length === 0 ? (
            <p className="mt-4 text-[13.5px] text-ink-muted">Nothing opened yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {files.map((file) => (
                <li key={file.fileId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13.5px] text-ink">{file.fileName}</span>
                  <span className="shrink-0 text-[12.5px] text-ink-muted">
                    {file.opens} {file.opens === 1 ? 'open' : 'opens'}
                    {file.citations > 0 ? ` · ${file.citations} cited` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {level === 'advanced' && pages.length > 0 ? (
        <Card>
          <SectionHeading
            title="Most viewed pages"
            description="Where recipients actually spent their attention."
          />
          <ul className="mt-5 space-y-2.5">
            {pages.map((page) => (
              <li
                key={`${page.fileId}-${page.page}`}
                className="flex items-baseline justify-between gap-3 text-[13.5px]"
              >
                <span className="truncate text-ink">
                  {page.fileName} <span className="text-ink-muted">· page {page.page}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-ink-muted">
                  {page.views} {page.views === 1 ? 'view' : 'views'}
                  {page.averageSeconds > 0 ? ` · ${page.averageSeconds}s avg` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionHeading
          title="Unanswered"
          description={
            unanswered.length > 0
              ? `${unanswered.length} ${unanswered.length === 1 ? 'question' : 'questions'} the shared material did not answer.`
              : undefined
          }
        />
        {unanswered.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-ink-muted">
            Everything people asked was answered by your documents.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {unanswered.map((question) => (
              <li key={question.id} className="border-l-2 border-warning/40 pl-3">
                <p className="text-[13.5px] leading-snug text-ink">&ldquo;{question.text}&rdquo;</p>
                <p className="mt-0.5 text-[12px] text-ink-subtle">
                  {question.topicLabel ? `${question.topicLabel} · ` : ''}
                  {formatRelativeTime(question.askedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {visitors.length > 0 ? (
        <Card>
          <SectionHeading
            title="Who opened it"
            description="Shown because you required recipients to confirm an email."
          />
          <ul className="mt-5 space-y-2.5">
            {visitors.map((visitor) => (
              <li
                key={visitor.email}
                className="flex items-baseline justify-between gap-3 text-[13.5px]"
              >
                <span className="truncate text-ink">{visitor.email}</span>
                <span className="shrink-0 text-[12.5px] text-ink-muted">
                  {visitor.visitCount} {visitor.visitCount === 1 ? 'visit' : 'visits'} ·{' '}
                  {formatRelativeTime(visitor.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {level === 'basic' ? (
        <p className="text-center text-[13px] text-ink-muted">
          Per-page engagement and identified visitors are available on paid plans.{' '}
          <Link href="/pricing" className="text-accent hover:text-accent-hover">
            See plans
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** A minimal bar chart. No chart library for two series of thirty points. */
function ActivityChart({ series }: { series: { day: string; views: number; questions: number }[] }) {
  const max = Math.max(...series.map((point) => Math.max(point.views, point.questions)), 1);

  return (
    <figure className="mt-5">
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Daily views and questions">
        {series.map((point) => (
          <div key={point.day} className="group relative flex flex-1 flex-col justify-end gap-[2px]">
            <div
              className="w-full rounded-t-[2px] bg-accent/85"
              style={{ height: `${(point.views / max) * 70}%` }}
            />
            <div
              className="w-full rounded-t-[2px] bg-accent/30"
              style={{ height: `${(point.questions / max) * 30}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-ink px-2 py-1 text-[11px] text-white group-hover:block">
              {point.day}: {point.views} views, {point.questions} questions
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex items-center gap-4 text-[11.5px] text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-accent/85" /> Views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-accent/30" /> Questions
        </span>
      </figcaption>
    </figure>
  );
}
