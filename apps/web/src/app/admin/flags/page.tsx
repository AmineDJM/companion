import { schema } from '@companion/db';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { AdminPage } from '@/components/admin/shell';
import { FlagEditor } from '@/components/admin/flag-editor';

export const dynamic = 'force-dynamic';

export default async function AdminFlagsPage() {
  await requireSuperAdmin();
  const { db } = getContainer();
  const flags = await db.select().from(schema.featureFlags).orderBy(schema.featureFlags.key);

  return (
    <AdminPage
      title="Feature flags"
      description="Enable globally, per plan, or for specific workspaces. Every change is audited."
    >
      <div className="space-y-3">
        {flags.map((flag) => (
          <FlagEditor
            key={flag.key}
            flag={{
              key: flag.key,
              description: flag.description,
              enabledGlobally: flag.enabledGlobally,
              enabledPlans: flag.enabledPlans,
              enabledWorkspaceIds: flag.enabledWorkspaceIds,
            }}
          />
        ))}
      </div>
    </AdminPage>
  );
}
