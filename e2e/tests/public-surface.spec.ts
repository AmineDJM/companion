import { expect, test } from '@playwright/test';

/**
 * The public surface.
 *
 * The homepage is the product: a visitor must be able to drop files without
 * being asked who they are first. Search engines must be able to read that
 * page and must never be able to read a shared document.
 */
test.describe('homepage', () => {
  test('puts the dropzone above the fold, with no signup gate', async ({ page }) => {
    await page.goto('/');

    const dropzone = page.getByTestId('dropzone');
    await expect(dropzone).toBeVisible();

    // Above the fold: visible without scrolling, on every viewport.
    const box = await dropzone.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(viewport!.height);

    // Nothing asks for an account before there is anything to protect.
    await expect(page.getByRole('textbox', { name: /email/i })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /password/i })).toHaveCount(0);
  });

  test('sets the security headers on every response', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    // The framework's version banner is a free gift to a scanner.
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('is indexable and carries the metadata a share preview needs', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/companion/i);
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute('content', /.{40,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  });

  test('keeps shared documents out of robots.txt and the sitemap', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    const body = await robots.text();
    expect(body).toContain('Disallow: /c/');
    expect(body).toContain('Disallow: /admin/');

    const sitemap = await request.get('/sitemap.xml');
    const xml = await sitemap.text();
    // A customer's document must never be discoverable from the sitemap.
    expect(xml).not.toContain('/c/');
    expect(xml).toContain('/pricing');
  });

  test('reaches the pricing page without an account', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('protected surfaces', () => {
  test('does not reveal that the admin console exists', async ({ request }) => {
    const response = await request.get('/admin', { maxRedirects: 0 });
    // Signed out, /admin must not be an invitation to guess credentials.
    expect([302, 303, 307, 404]).toContain(response.status());

    const body = await response.text().catch(() => '');
    expect(body.toLowerCase()).not.toContain('super admin');
  });

  test('sends a missing share link to a plain not-found, not a stack trace', async ({ page }) => {
    const response = await page.goto('/c/zzzzzz');
    expect(response?.status()).toBe(404);

    const body = (await page.content()).toLowerCase();
    expect(body).not.toContain('at async');
    expect(body).not.toContain('node_modules');
  });

  test('marks any share-link response noindex', async ({ request }) => {
    const response = await request.get('/c/zzzzzz');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('refuses an unauthenticated admin API call', async ({ request }) => {
    const response = await request.post('/api/admin/quality/run', { failOnStatusCode: false });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('accessibility basics', () => {
  test('gives the page one h1, a skip target and a language', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', /en/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('#main')).toHaveCount(1);
  });

  test('is operable from the keyboard alone', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      return element ? element.tagName.toLowerCase() : null;
    });
    expect(focused).not.toBeNull();
    expect(focused).not.toBe('body');
  });

  test('has no horizontal overflow at any viewport', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A single pixel of rounding is not a layout bug; a scrollbar is.
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
