import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/shell';
import { AdminSearch } from '@/components/admin/search';
import { requireSuperAdmin } from '@/server/auth/session';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Companion Ops' },
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * Admin authorisation.
 *
 * Enforced server-side on every request through `requireSuperAdmin`, which
 * throws a not-found for anyone else so the console is indistinguishable from
 * a missing route. Hiding navigation is never treated as a control.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSuperAdmin().catch(() => null);
  if (!auth) notFound();

  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-pathname') ?? '/admin';

  return (
    <AdminShell pathname={pathname} adminEmail={auth.user.email}>
      <div className="border-b border-[color:var(--admin-line)] px-5 py-3 sm:px-7">
        <AdminSearch />
      </div>
      {children}
    </AdminShell>
  );
}
