import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/server/env';

// Resolved per request rather than baked in: the origin is known at runtime on
// every platform, and at build time only on some.
export const dynamic = 'force-dynamic';

/**
 * Public marketing pages are indexable. Everything that could expose customer
 * material — shared links, the app, the admin console, API routes — is not.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = canonicalUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/c/', '/app/', '/admin/', '/api/', '/settings', '/billing', '/login', '/signup'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
