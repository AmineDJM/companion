import type { Metadata } from 'next';
import { requireAuth } from '@/server/auth/session';
import { effectiveMaxUploadBytes } from '@/server/services/entitlements';
import { getCompanionSlots } from '@/server/services/quota';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { CreateFlow } from '@/components/create-flow';
import { Eyebrow } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { formatBytes } from '@companion/shared';

export const metadata: Metadata = {
  title: 'Create a Companion',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewCompanionPage() {
  const auth = await requireAuth();
  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new Error('Workspace not found');

  const [maxUploadBytes, slots] = await Promise.all([
    effectiveMaxUploadBytes(workspace.entitlements),
    getCompanionSlots(workspace.id, workspace.entitlements),
  ]);

  if (slots.exhausted) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center sm:px-6">
        <Eyebrow>Create a Companion</Eyebrow>
        <h1 className="mt-3 text-[24px] text-ink text-balance">
          You&rsquo;ve used all {slots.limit} of your active Companions
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted text-pretty">
          Nothing has been deleted. Archive a Companion you no longer share, or move to a plan with
          more room.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink href="/app/companions" variant="secondary">
            Manage Companions
          </ButtonLink>
          <ButtonLink href="/pricing">See plans</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-14">
      <Eyebrow>Create a Companion</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-[1.15] tracking-[-0.03em] text-ink text-balance">
        Share the documents.
        <br />
        <span className="text-ink-muted">Keep the control.</span>
      </h1>
      <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed text-ink-muted text-pretty">
        Drop anything you want to share. Companion turns it into one intelligent, controlled link.
      </p>

      <div className="mt-8">
        <CreateFlow authenticated maxUploadBytes={maxUploadBytes} />
      </div>

      <p className="mt-6 text-[12.5px] text-ink-subtle">
        Up to {formatBytes(maxUploadBytes)} per file on your plan
        {slots.limit !== null ? ` · ${slots.remaining} Companion slots left` : ''}.
      </p>
    </div>
  );
}
