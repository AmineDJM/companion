import Link from 'next/link';
import { billingEnabled } from '@/server/env';
import { CompanionMark } from './ui/logo';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <CompanionMark size={18} />
          <span>© {new Date().getFullYear()} Companion</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
          {billingEnabled() ? <FooterLink href="/pricing">Pricing</FooterLink> : null}
          <FooterLink href="/security">Security</FooterLink>
          <FooterLink href="/privacy">Privacy</FooterLink>
          <FooterLink href="/terms">Terms</FooterLink>
        </nav>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-ink-muted transition-colors hover:text-ink">
      {children}
    </Link>
  );
}
