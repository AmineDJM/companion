import { notFound } from 'next/navigation';
import { requireAuth } from '@/server/auth/session';
import { getCompanionById } from '@/server/services/companions';
import { loadWorkspaceContext } from '@/server/services/workspace';
import { getContainer } from '@/server/container';
import { eq, schema } from '@companion/db';
import { AccessControls } from '@/components/app/access-controls';
import { emailDeliveryAvailable } from '@/server/email';

export const dynamic = 'force-dynamic';

export default async function CompanionAccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;

  const companion = await getCompanionById(id, auth.workspace.id);
  if (!companion) notFound();

  const workspace = await loadWorkspaceContext(auth.workspace.id);
  if (!workspace) notFound();

  const { db } = getContainer();
  const policyRows = await db
    .select()
    .from(schema.companionAccessPolicies)
    .where(eq(schema.companionAccessPolicies.companionId, companion.id))
    .limit(1);
  const policy = policyRows[0];

  return (
    <AccessControls
      companionId={companion.id}
      slug={companion.slug}
      initial={{
        accessMode: companion.accessMode,
        hasPassword: Boolean(policy?.passwordHash),
        allowedEmails: policy?.allowedEmails ?? [],
        allowedDomains: policy?.allowedDomains ?? [],
        expiresAt: companion.expiresAt?.toISOString() ?? null,
        downloadAllowed: companion.downloadAllowed,
        aiEnabled: companion.aiEnabled,
        sourceProtectionMode: companion.sourceProtectionMode,
        showCompanionBranding: companion.branding.showCompanionBranding,
        senderLabel: companion.branding.senderLabel,
      }}
      entitlements={{
        passwordProtection: workspace.entitlements.passwordProtection,
        emailListAccess: workspace.entitlements.emailListAccess,
        // Configuration, not plan: the two confirm-by-email modes need a
        // provider. Sharing a link never does.
        emailDelivery: emailDeliveryAvailable(),
        identifiedAccess: workspace.entitlements.identifiedAccess,
        customExpiration: workspace.entitlements.customExpiration,
        removeBranding: workspace.entitlements.removeBranding,
      }}
    />
  );
}
