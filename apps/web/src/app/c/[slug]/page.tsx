import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RECIPIENT_ERROR_COPY, evaluateCompanionAvailability, isValidSlug } from '@companion/shared';
import { ViewerShell } from '@/components/viewer/viewer-shell';
import { AccessGate } from '@/components/viewer/access-gate';
import { UnavailableScreen } from '@/components/viewer/unavailable';
import { recordCompanionOpen } from '@/server/services/analytics';
import { getCompanionBySlug, loadAccessState } from '@/server/services/companions';
import { ensureRecipientSession, evaluateAccess } from '@/server/services/recipient-session';
import { buildViewerPayload } from '@/server/services/viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Shared Companion links must never be indexed, whatever the access mode.
 * This is set here as well as in the response headers, belt and braces.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
};

export default async function CompanionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { slug } = await params;
  const { f: requestedFileId } = await searchParams;

  if (!isValidSlug(slug)) notFound();

  const companion = await getCompanionBySlug(slug);
  if (!companion) notFound();

  // A dead link is reported before any session is created, so revoked content
  // never even mints a cookie.
  const state = await loadAccessState(companion);
  const availability = evaluateCompanionAvailability(state);
  if (!availability.allowed) {
    return (
      <UnavailableScreen
        title={RECIPIENT_ERROR_COPY[availability.code] ?? availability.message}
        code={availability.code}
      />
    );
  }

  const session = await ensureRecipientSession(companion);
  const decision = await evaluateAccess(companion, session);

  if (!decision.allowed) {
    if (decision.code === 'password_required' || decision.code === 'password_incorrect') {
      return <AccessGate slug={slug} mode="password" senderLabel={companion.branding.senderLabel} />;
    }
    if (decision.code === 'identity_required' || decision.code === 'email_not_allowed') {
      return <AccessGate slug={slug} mode="identity" senderLabel={companion.branding.senderLabel} />;
    }
    return (
      <UnavailableScreen
        title={RECIPIENT_ERROR_COPY[decision.code] ?? decision.message}
        code={decision.code}
      />
    );
  }

  const payload = await buildViewerPayload(companion, requestedFileId ?? null);

  await recordCompanionOpen({
    companionId: companion.id,
    workspaceId: companion.workspaceId,
    recipientSessionId: session.id,
    isNewVisitor: session.questionCount === 0 && !session.verifiedEmail,
  });

  if (payload.files.length === 0) {
    return (
      <UnavailableScreen
        title="This document is still being prepared."
        description="Try again in a moment — the sender is still uploading."
        code="companion_not_ready"
      />
    );
  }

  return (
    <ViewerShell
      initial={{
        slug: payload.slug,
        name: payload.name,
        status: payload.status,
        senderLabel: payload.senderLabel,
        branding: payload.branding,
        downloadAllowed: payload.downloadAllowed,
        aiEnabled: payload.aiEnabled,
        expiresAt: payload.expiresAt,
        files: payload.files,
        activeFileId: payload.activeFileId,
        preview: payload.preview,
        multiFile: payload.multiFile,
      }}
    />
  );
}
