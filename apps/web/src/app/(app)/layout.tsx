import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { getAuthContext } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/** Shell for every authenticated sender page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        user={{
          name: auth.user.name,
          email: auth.user.email,
          isSuperAdmin: auth.user.platformRole === 'super_admin',
        }}
      />
      {auth.workspace.status === 'suspended' ? (
        <div
          role="alert"
          className="border-b border-danger/20 bg-danger-soft px-5 py-2.5 text-center text-[13px] text-danger"
        >
          This workspace is suspended. Existing links are unavailable. Contact support to restore access.
        </div>
      ) : null}
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
