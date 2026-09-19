import type { Metadata } from 'next';
import { CompanionMark } from '@/components/ui/logo';

export const metadata: Metadata = {
  title: 'This document is no longer available',
  robots: { index: false, follow: false },
};

/**
 * What a recipient sees when a link does not resolve.
 *
 * Deliberately says nothing about *why*. A link that was revoked, one that
 * expired and one that never existed all look identical here, because telling
 * them apart would let anyone with a list of guesses learn which slugs are
 * real. The sender is the person who knows what happened, so the page points
 * at them rather than offering a support address.
 */
export default function CompanionNotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center"
    >
      <CompanionMark size={34} />
      <h1 className="mt-6 text-[20px] tracking-[-0.02em] text-ink">
        This document is no longer available
      </h1>
      <p className="mt-2 max-w-sm text-[14px] leading-[1.6] text-ink-muted">
        The link may have expired, or the person who shared it may have turned it off. Ask them for
        a new one — the address they send will work straight away.
      </p>
    </main>
  );
}
