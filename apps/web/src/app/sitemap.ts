import type { MetadataRoute } from 'next';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Only public pages. Shared Companion links are never listed — customer
 * documents must never reach a search index.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${APP_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${APP_URL}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${APP_URL}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${APP_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${APP_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
