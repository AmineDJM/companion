import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The journey the product is sold on.
 *
 * A visitor drops a file on the homepage, creates an account only once the
 * upload has value behind it, and gets one link. Opening that link in a fresh
 * browser context — no cookies, no account — shows the document.
 *
 * Skipped unless E2E_FULL_JOURNEY is set, because it needs a worker, Redis and
 * LibreOffice running: a skipped test is honest, a mocked one is not.
 */
const enabled = Boolean(process.env['E2E_FULL_JOURNEY']);

test.describe('share journey', () => {
  test.skip(!enabled, 'Set E2E_FULL_JOURNEY=1 with the worker and Redis running.');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  const password = 'e2e-password-that-is-long-enough';
  const email = `e2e-${Date.now()}@example.test`;
  let shareUrl = '';

  async function dropFile(page: Page) {
    // A real PDF, produced by the repository's own fixture script.
    const pdf = readFileSync(new URL('../fixtures/contract.pdf', import.meta.url));
    await page.getByTestId('dropzone').dispatchEvent('drop', {
      dataTransfer: await page.evaluateHandle(
        async ({ bytes, name }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
          return transfer;
        },
        { bytes: [...pdf], name: 'contract.pdf' },
      ),
    });
  }

  test('a visitor turns a file into a link', async ({ page }) => {
    await page.goto('/');
    await dropFile(page);

    await expect(page.getByText('contract.pdf')).toBeVisible();
    await page.getByRole('button', { name: /attach companion/i }).click();

    // The account is requested here — after the upload, not before it.
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).first().fill(password);
    await page.getByRole('button', { name: /create|continue|sign up/i }).first().click();

    // Processing is plain language; no technical vocabulary reaches the sender.
    await expect(page.getByText(/reading|preparing|understanding/i)).toBeVisible({
      timeout: 30_000,
    });

    await page.waitForURL(/\/app\/companions\/|\/c\//, { timeout: 180_000 });
    const link = page.getByTestId('share-link');
    await expect(link).toBeVisible({ timeout: 120_000 });
    shareUrl = (await link.getAttribute('data-url')) ?? (await link.inputValue());
    expect(shareUrl).toMatch(/\/c\/[0-9A-Za-z]{6}/);
  });

  test('a recipient with no account sees the document', async ({ browser }) => {
    expect(shareUrl).not.toBe('');
    const context = await browser.newContext();
    const page = await context.newPage();

    const started = Date.now();
    await page.goto(shareUrl);

    // The document itself, not a landing page about documents.
    const firstPage = page.getByTestId('document-page').first();
    await expect(firstPage).toBeVisible({ timeout: 20_000 });
    expect(Date.now() - started).toBeLessThan(15_000);

    // Nothing asks the reader who they are.
    await expect(page.getByRole('button', { name: /sign up|create account/i })).toHaveCount(0);

    // The ask affordance is present and quiet.
    await expect(page.getByPlaceholder(/ask anything/i)).toBeVisible();

    await context.close();
  });

  test('an answer cites a page and navigates to it', async ({ browser }) => {
    test.skip(!process.env['OPENAI_API_KEY'], 'Answering needs a provider key.');
    expect(shareUrl).not.toBe('');

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(shareUrl);

    await page.getByPlaceholder(/ask anything/i).fill('What is the annual licence fee?');
    await page.keyboard.press('Enter');

    const answer = page.getByTestId('answer').first();
    await expect(answer).toBeVisible({ timeout: 60_000 });

    const citation = page.getByTestId('citation').first();
    await expect(citation).toBeVisible();
    await citation.click();

    // A citation that does not move the reader to the passage is decoration.
    await expect(page.getByTestId('document-page').first()).toBeInViewport();

    await context.close();
  });
});
