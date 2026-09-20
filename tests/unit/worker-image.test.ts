import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The worker image, which is the only part of Companion with system
 * dependencies and the only one that can fail to build at all.
 *
 * Every rule here was a real deploy failure, not a precaution.
 */
const dockerfile = readFileSync(
  join(process.cwd(), 'apps/worker/Dockerfile'),
  'utf8',
);

describe('the worker Dockerfile', () => {
  it('never prunes, which cannot work after a filtered install', () => {
    // `pnpm install --filter @companion/worker...` leaves a partial workspace,
    // so an unfiltered prune wants to purge the whole modules directory and
    // refuses without a terminal:
    //
    //   ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
    //
    // Setting CI=true to get past that is the trap: the purge then succeeds
    // and nothing restores the workspace packages' production dependencies,
    // so the image builds green and dies on its first require.
    const commands = dockerfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(commands).not.toMatch(/pnpm\s+prune/);
  });

  it('never fetches a browser it has no use for', () => {
    // The e2e workspace pulls in Playwright, whose postinstall downloads
    // Chromium. Nothing in this image runs a browser.
    expect(dockerfile).toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1');
  });

  it('installs the tools conversion actually needs', () => {
    // LibreOffice normalises Office formats to PDF and Poppler rasterises the
    // pages. Without either, every non-PDF upload fails in the worker rather
    // than at the door, which is the slowest possible place to find out.
    for (const pkg of ['libreoffice-writer', 'libreoffice-calc', 'libreoffice-impress', 'poppler-utils']) {
      expect(dockerfile, pkg).toContain(pkg);
    }
  });

  it('gives LibreOffice a writable home, which it needs on first run', () => {
    expect(dockerfile).toMatch(/ENV HOME=/);
  });

  it('does not run as root', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });
});
