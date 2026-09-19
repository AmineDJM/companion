import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Security headers applied to every response. The recipient viewer additionally
 * sets `X-Robots-Tag: noindex` from its own route so shared documents never
 * enter a search index.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the repo free of files the framework generates for editors.
  agentRules: false,
  // The worker packages are Node-only; keep them out of the client bundle.
  serverExternalPackages: ['postgres', 'bullmq', 'ioredis', '@aws-sdk/client-s3'],
  experimental: {
    optimizePackageImports: ['@companion/shared'],
  },
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Recipient content must never be cached by a shared proxy.
      {
        source: '/c/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        ],
      },
      {
        source: '/api/c/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
