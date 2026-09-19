import type { Metadata } from 'next';
import { formatBytes, formatDateLong } from '@companion/shared';
import { requireAuth, activeSessionCount } from '@/server/auth/session';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { SettingsForm } from '@/components/app/settings-form';
import { Card, SectionHeading } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await requireAuth();
  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) throw new Error('Workspace not found');

  const sessions = await activeSessionCount(auth.user.id);

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
      <h1 className="text-[26px] tracking-[-0.03em] text-ink">Settings</h1>

      <SettingsForm
        initial={{
          name: auth.user.name ?? '',
          email: auth.user.email,
          workspaceName: workspace.name,
          senderLabel: (workspace as { name: string }).name,
        }}
      />

      <Card className="mt-6">
        <SectionHeading title="Workspace" />
        <dl className="mt-4 space-y-2.5 text-[13.5px]">
          <Row label="Plan" value={workspace.planKey.charAt(0).toUpperCase() + workspace.planKey.slice(1)} />
          <Row
            label="Storage used"
            value={`${formatBytes(workspace.storageBytesUsed)} of ${formatBytes(workspace.entitlements.storageBytes)}`}
          />
          <Row label="Team members" value={`1 of ${workspace.entitlements.maxTeamMembers}`} />
          <Row label="Active sessions" value={String(sessions)} />
          {workspace.subscription?.currentPeriodEnd ? (
            <Row label="Renews" value={formatDateLong(workspace.subscription.currentPeriodEnd)} />
          ) : null}
        </dl>
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
