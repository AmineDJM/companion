import { notFound } from 'next/navigation';
import { requireAuth } from '@/server/auth/session';
import { getCompanionById } from '@/server/services/companions';
import { CompanionHeader } from '@/components/app/companion-header';

export const dynamic = 'force-dynamic';

export default async function CompanionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const companion = await getCompanionById(id, auth.workspace.id);
  if (!companion) notFound();

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
      <CompanionHeader
        id={companion.id}
        name={companion.name}
        slug={companion.slug}
        status={companion.effectiveStatus}
      />
      <div className="mt-7">{children}</div>
    </div>
  );
}
