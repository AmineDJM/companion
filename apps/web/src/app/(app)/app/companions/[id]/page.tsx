import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatBytes, formatDateLong, formatRelativeTime } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import {
  companionOverview,
  companionTopics,
  recentActivity,
  recentQuestions,
  unansweredQuestions,
} from '@/server/services/analytics';
import { getCompanionById } from '@/server/services/companions';
import { listFiles } from '@/server/services/files';
import { CreatedBanner } from '@/components/app/created-banner';
import { ProcessingStatus } from '@/components/app/processing-status';
import { DownloadToggle } from '@/components/app/download-toggle';
import { Card, EmptyState, SectionHeading, Stat, StatRow } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

export default async function CompanionOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const { created } = await searchParams;

  const companion = await getCompanionById(id, auth.workspace.id);
  if (!companion) notFound();

  const [overview, topics, activity, questions, unanswered, files] = await Promise.all([
    companionOverview(companion.id),
    companionTopics(companion.id, 5),
    recentActivity(companion.id, 6),
    recentQuestions(companion.id, 5),
    unansweredQuestions(companion.id, 5),
    listFiles(companion.id),
  ]);

  const isBuilding = companion.effectiveStatus === 'PROCESSING';
  const failed = files.filter((file) => file.status === 'FAILED' || file.status === 'UNSUPPORTED');

  return (
    <div className="space-y-6">
      {created === '1' && !isBuilding ? (
        <CreatedBanner slug={companion.slug} companionId={companion.id} />
      ) : null}

      {isBuilding ? (
        <ProcessingStatus companionId={companion.id} initialProgress={companion.processingProgress} />
      ) : null}

      {companion.effectiveStatus === 'FAILED' ? (
        <div className="rounded-[16px] border border-danger/20 bg-danger-soft px-5 py-4">
          <p className="text-[14px] font-[520] text-danger">This Companion could not be prepared</p>
          <p className="mt-1 text-[13px] text-danger/85">
            {companion.processingError ?? 'None of the uploaded files could be read.'}
          </p>
          <ButtonLink
            href={`/app/companions/${companion.id}/files`}
            variant="secondary"
            size="sm"
            className="mt-3"
          >
            Review files
          </ButtonLink>
        </div>
      ) : null}

      {failed.length > 0 && companion.effectiveStatus !== 'FAILED' ? (
        <div className="rounded-[16px] border border-warning/20 bg-warning-soft px-5 py-4">
          <p className="text-[13.5px] font-[520] text-warning">
            {failed.length} {failed.length === 1 ? 'file' : 'files'} could not be read
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-warning/90">
            {failed.slice(0, 3).map((file) => (
              <li key={file.id}>
                {file.name} — {file.statusMessage ?? 'Unsupported file.'}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-warning/80">
            The rest of this Companion works normally.
          </p>
        </div>
      ) : null}

      <Card>
        <StatRow>
          <Stat label="Views" value={overview.views} />
          <Stat label="Visitors" value={overview.visitors} />
          <Stat label="Questions" value={overview.questions} />
          <Stat
            label="Unanswered"
            value={overview.unanswered}
            hint={overview.unanswered > 0 ? 'Worth a look' : undefined}
          />
        </StatRow>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading
            title="Included files"
            description={`${files.filter((file) => !file.isContainer).length} documents · ${formatBytes(companion.storageBytes)}`}
            action={
              <ButtonLink href={`/app/companions/${companion.id}/files`} variant="ghost" size="sm">
                Manage
              </ButtonLink>
            }
          />
          <ul className="mt-4 space-y-1.5">
            {files.slice(0, 6).map((file) => (
              <li key={file.id} className="flex items-center gap-2.5 text-[13.5px]">
                <FileIcon size={15} className="shrink-0 text-ink-subtle" />
                <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
                <span className="shrink-0 text-[12px] text-ink-subtle">
                  {formatBytes(file.sizeBytes)}
                </span>
              </li>
            ))}
            {files.length > 6 ? (
              <li className="pt-1 text-[12.5px] text-ink-subtle">
                and {files.length - 6} more
              </li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <SectionHeading title="Access" description="Who can open this link, and what they can do." />
          <dl className="mt-4 space-y-2.5 text-[13.5px]">
            <Row
              label="Who can open it"
              value={
                companion.accessMode === 'PUBLIC'
                  ? 'Anyone with the link'
                  : companion.accessMode === 'PASSWORD'
                    ? 'Anyone with the password'
                    : companion.accessMode === 'EMAIL_LIST'
                      ? 'Specific people'
                      : 'Identified visitors'
              }
            />
            <Row
              label="Expires"
              value={companion.expiresAt ? formatDateLong(companion.expiresAt) : 'Never'}
            />
            <Row label="Questions" value={companion.aiEnabled ? 'Enabled' : 'Turned off'} />
          </dl>

          <DownloadToggle
            companionId={companion.id}
            accessMode={companion.accessMode}
            initialAllowed={companion.downloadAllowed}
          />

          <ButtonLink
            href={`/app/companions/${companion.id}/access`}
            variant="secondary"
            size="sm"
            className="mt-4"
          >
            Change access
          </ButtonLink>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Most asked subjects" />
          {topics.length === 0 ? (
            <p className="mt-4 text-[13.5px] text-ink-muted">
              No questions yet. Subjects appear once people start asking.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {topics.map((topic) => (
                <li key={topic.slug} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13.5px] text-ink">{topic.label}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-ink-muted">
                    {topic.questionCount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Unanswered questions"
            action={
              unanswered.length > 0 ? (
                <ButtonLink
                  href={`/app/companions/${companion.id}/analytics`}
                  variant="ghost"
                  size="sm"
                >
                  See all
                </ButtonLink>
              ) : undefined
            }
          />
          {unanswered.length === 0 ? (
            <p className="mt-4 text-[13.5px] text-ink-muted">
              Nothing has gone unanswered so far.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {unanswered.map((question) => (
                <li key={question.id} className="text-[13.5px] leading-snug text-ink">
                  &ldquo;{question.text}&rdquo;
                  <span className="block text-[12px] text-ink-subtle">
                    {formatRelativeTime(question.askedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeading title="Latest activity" />
        {activity.length === 0 && questions.length === 0 ? (
          <EmptyState
            className="mt-4 border-0 py-8"
            title="No activity yet"
            description="Insights will appear after people begin opening your Companion."
            action={
              <Link
                href={`/c/${companion.slug}`}
                target="_blank"
                className="text-[13px] text-accent hover:text-accent-hover"
              >
                Preview the recipient view
              </Link>
            }
          />
        ) : (
          <ul className="mt-4 space-y-2">
            {activity.map((entry, index) => (
              <li
                key={`${entry.type}-${index}`}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <span className="text-ink">
                  {describeEvent(entry.type)}
                  {entry.fileName ? (
                    <span className="text-ink-muted">
                      {' '}
                      · {entry.fileName}
                      {entry.page ? ` p${entry.page}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] text-ink-subtle">
                  {formatRelativeTime(entry.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function describeEvent(type: string): string {
  switch (type) {
    case 'companion_opened':
      return 'Someone opened the link';
    case 'file_opened':
      return 'A document was opened';
    case 'page_viewed':
      return 'A page was read';
    case 'question_asked':
      return 'A question was answered';
    case 'question_unanswered':
      return 'A question had no answer';
    case 'citation_opened':
      return 'A source was opened';
    case 'download_clicked':
      return 'A file was downloaded';
    case 'password_success':
      return 'Password accepted';
    case 'password_failure':
      return 'Wrong password entered';
    case 'identity_verified':
      return 'A visitor confirmed their email';
    case 'access_denied':
      return 'Access was refused';
    default:
      return 'Activity';
  }
}
