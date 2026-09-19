import Link from 'next/link';
import { Wordmark } from '@/components/ui/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Companion home">
          <Wordmark />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 pb-16">
        {children}
      </main>
    </div>
  );
}
