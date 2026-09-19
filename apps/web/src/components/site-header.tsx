import Link from 'next/link';
import { Wordmark } from './ui/logo';
import { ButtonLink } from './ui/button';
import { UserMenu } from './user-menu';

export interface HeaderUser {
  name: string | null;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * One header for the whole product. Minimal by design: no mega-menu, and no
 * sidebar unless a page genuinely needs one.
 */
export function SiteHeader({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 sm:px-6">
        <Link href={user ? '/app/companions' : '/'} className="shrink-0" aria-label="Companion home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {user ? (
            <HeaderLink href="/app/companions">My Companions</HeaderLink>
          ) : (
            <HeaderLink href="/security">Security</HeaderLink>
          )}
          <HeaderLink href="/pricing">Pricing</HeaderLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <ButtonLink href="/app/companions/new" size="sm" className="hidden sm:inline-flex">
                Create Companion
              </ButtonLink>
              <UserMenu name={user.name} email={user.email} isSuperAdmin={user.isSuperAdmin} />
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Create a Companion
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[9px] px-2.5 py-1.5 text-[13.5px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {children}
    </Link>
  );
}
