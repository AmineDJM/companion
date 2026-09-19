import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getAuthContext } from '@/server/auth/session';
import { draftSummary } from '@/server/services/drafts';

export const metadata: Metadata = {
  title: 'Log in',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const auth = await getAuthContext();
  if (auth) redirect('/app/companions');

  const { draft } = await searchParams;
  const pending = draft ? await draftSummary(draft) : null;

  return <AuthForm mode="login" draftToken={draft ?? null} pendingFiles={pending?.fileCount ?? 0} />;
}
