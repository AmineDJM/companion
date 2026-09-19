import { describe, expect, it } from 'vitest';
import { canonicalUrl, canonicalUrlSource } from '../../apps/web/src/server/env';

/**
 * The canonical origin.
 *
 * Every server-generated URL comes from here: share links, Stripe returns,
 * email links, OAuth callbacks and page metadata. Getting the precedence
 * wrong sends a recipient to the wrong host, which is the kind of defect that
 * only shows up once someone has already clicked.
 */
describe('canonicalUrl', () => {
  it('prefers the explicit override', () => {
    expect(
      canonicalUrl({
        APP_URL: 'https://companion.app',
        RENDER_EXTERNAL_URL: 'https://companion-web.onrender.com',
      }),
    ).toBe('https://companion.app');
  });

  it('falls back to the platform URL, so a first deploy works unconfigured', () => {
    expect(canonicalUrl({ RENDER_EXTERNAL_URL: 'https://companion-web.onrender.com' })).toBe(
      'https://companion-web.onrender.com',
    );
  });

  it('builds an origin from the platform hostname when only that is given', () => {
    expect(canonicalUrl({ RENDER_EXTERNAL_HOSTNAME: 'companion-web.onrender.com' })).toBe(
      'https://companion-web.onrender.com',
    );
  });

  it('falls back to localhost for development', () => {
    expect(canonicalUrl({})).toBe('http://localhost:3000');
  });

  it('strips a trailing slash so callers can concatenate a path', () => {
    expect(canonicalUrl({ APP_URL: 'https://companion.app/' })).toBe('https://companion.app');
  });

  it('ignores an empty string, which is how an unset platform variable arrives', () => {
    expect(canonicalUrl({ APP_URL: '', RENDER_EXTERNAL_URL: 'https://from-render.test' })).toBe(
      'https://from-render.test',
    );
  });

  it('ignores whitespace pasted into the dashboard', () => {
    expect(canonicalUrl({ APP_URL: '   ', RENDER_EXTERNAL_URL: 'https://from-render.test' })).toBe(
      'https://from-render.test',
    );
  });

  it('needs no other configuration, so it works during a build', () => {
    // Nothing here reads a secret: page metadata is generated at build time,
    // where DATABASE_URL and SESSION_SECRET are not necessarily present.
    expect(() => canonicalUrl({ APP_URL: 'https://companion.app' })).not.toThrow();
  });
});

describe('canonicalUrlSource', () => {
  it('reports the override', () => {
    expect(canonicalUrlSource({ APP_URL: 'https://companion.app' })).toBe('APP_URL');
  });

  it('reports the platform', () => {
    expect(canonicalUrlSource({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' })).toBe(
      'RENDER_EXTERNAL_URL',
    );
  });

  it('reports the fallback, which readiness treats as critical in production', () => {
    expect(canonicalUrlSource({})).toBe('fallback');
  });
});
