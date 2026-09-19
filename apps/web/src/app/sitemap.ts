import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/server/env';

export const dynamic = 'force-dynamic';

/**
 * Only public pages. Shared Companion links are never listed — customer
 * documents must never reach a search index.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = canonicalUrl();
  const now = new Date();
  return [
    { url: `${origin}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${origin}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${origin}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
