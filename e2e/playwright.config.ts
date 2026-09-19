import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These run against a real browser and a running app, because the claims they
 * check are about what a browser actually receives: the headers on a share
 * link, whether a disabled download is reachable over the network, and whether
 * the first page of a document is visible before anything else loads.
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Three viewports, one engine. The failures these catch are layout and
  // affordance failures — a dropzone pushed below the fold on a phone, a page
  // that scrolls sideways — and those reproduce on Chromium. Adding WebKit
  // would mean installing a second browser to re-check the same CSS, so the
  // device profiles here are Chromium-backed on purpose.
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  // Started only when nothing is already listening, so a local dev server is
  // reused rather than fought over.
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm --filter @companion/web dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
        cwd: '../',
      },
});
