import type { MetadataRoute } from 'next';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Public marketing pages are indexable. Everything that could expose customer
 * material — shared links, the app, the admin console, API routes — is not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/c/', '/app/', '/admin/', '/api/', '/settings', '/billing', '/login', '/signup'],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
