import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { getAuthContext } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext().catch(() => null);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        user={
          auth
            ? {
                name: auth.user.name,
                email: auth.user.email,
                isSuperAdmin: auth.user.platformRole === 'super_admin',
              }
            : null
        }
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
