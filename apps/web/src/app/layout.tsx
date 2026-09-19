import type { Metadata, Viewport } from 'next';
import { BRAND } from '@companion/shared';
import { canonicalUrl } from '@/server/env';
import '../styles/globals.css';

/**
 * Metadata is generated per request rather than exported as a constant, so the
 * canonical origin is the one the server is actually reachable at. A constant
 * would be frozen at build time, which is exactly when the origin is least
 * reliably known.
 */
export function generateMetadata(): Metadata {
  const origin = canonicalUrl();
  return {
    metadataBase: new URL(origin),
    title: {
      default: 'Companion — Share Documents That Can Answer Questions',
      template: '%s · Companion',
    },
    description: BRAND.description,
    applicationName: BRAND.name,
    keywords: [
      'share documents securely',
      'share PDF without download',
      'document sharing link',
      'expiring document link',
      'revoke shared document',
      'interactive PDF link',
      'ask questions about a document',
    ],
    authors: [{ name: BRAND.name }],
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
        url: origin,
      title: 'Companion — Share Documents That Can Answer Questions',
      description: BRAND.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Companion — Share Documents That Can Answer Questions',
      description: BRAND.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
    },
    icons: {
      icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
      apple: [{ url: '/icon.svg' }],
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: BRAND.colors.background,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-surface focus:px-4 focus:py-2 focus:text-[14px] focus:shadow-[0_4px_12px_rgba(21,22,26,0.1)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
