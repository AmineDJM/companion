import { requireSuperAdmin } from '@/server/auth/session';
import { platformLimits } from '@/server/services/entitlements';
import { AdminPage } from '@/components/admin/shell';
import { LimitsEditor } from '@/components/admin/limits-editor';

export const dynamic = 'force-dynamic';

export default async function AdminLimitsPage() {
  await requireSuperAdmin();
  const limits = await platformLimits();

  return (
    <AdminPage
      title="Platform limits"
      description="Technical safety caps, independent of commercial plans. A plan can never raise one of these."
    >
      <LimitsEditor initial={limits} />
    </AdminPage>
  );
}
