import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { isAvailable, run } from './exec.js';

/**
 * Format conversion and page rasterisation.
 *
 * Office documents are normalised to PDF with LibreOffice so every recipient
 * sees identical layout. PDFs are rasterised to page images with Poppler, which
 * is what makes "downloads disabled" real: the viewer receives pictures of
 * pages, never the source file.
 *
 * There is deliberately no OCR here. Pages without usable embedded text are
 * read by the vision model instead — see lib/page-reader.ts.
 */
const LIBREOFFICE_TIMEOUT_MS = 180_000;
const RASTERISE_TIMEOUT_MS = 240_000;

export async function libreOfficeAvailable(): Promise<boolean> {
  return (await isAvailable('soffice')) || (await isAvailable('libreoffice'));
}

export async function popplerAvailable(): Promise<boolean> {
  return isAvailable('pdftoppm');
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'companion-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Converts a document to PDF. Returns null when no converter is available. */
export async function convertToPdf(
  buffer: Buffer,
  filename: string,
): Promise<Buffer | null> {
  const binary = (await isAvailable('soffice')) ? 'soffice' : 'libreoffice';
  if (!(await libreOfficeAvailable())) return null;

  return withTempDir(async (dir) => {
    const safeName = filename.replace(/[^\w.-]+/g, '_').slice(-120) || 'document';
    const inputPath = join(dir, safeName);
    await writeFile(inputPath, buffer);

    const profileDir = join(dir, 'profile');
    const result = await run(
      binary,
      [
        '--headless',
        '--norestore',
        '--invisible',
        '--nolockcheck',
        '--nodefault',
        '--nofirststartwizard',
        // A private profile stops concurrent conversions fighting over one.
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        inputPath,
      ],
      { timeoutMs: LIBREOFFICE_TIMEOUT_MS, cwd: dir },
    );

    if (result.timedOut) return null;

    const produced = (await readdir(dir)).find(
      (entry) => entry.toLowerCase().endsWith('.pdf') && entry !== safeName,
    );
    if (!produced) return null;
    return readFile(join(dir, produced));
  });
}

export interface RasterisedPage {
  page: number;
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Renders PDF pages to WebP images.
 *
 * 200 DPI, capped at 2400px wide. The old 150 DPI put an A4 page at 1241px,
 * which is fine at 100% zoom on a 1x display and visibly soft everywhere else:
 * a retina laptop showing that page at 850 CSS px wants 1700 device pixels,
 * and a 27-inch screen wants more still. 200 DPI puts A4 at 1654px and a
 * widescreen slide at the 2400px cap, which covers both without the file sizes
 * that would make the first page slow to arrive.
 *
 * The page is never enlarged, so a small source stays small rather than being
 * blown up into something that only looks like detail.
 */
const RENDER_DPI = 200;
const MAX_RENDER_WIDTH = 2_400;
export async function rasterisePdf(
  buffer: Buffer,
  options: { maxPages: number; dpi?: number; maxWidth?: number } = { maxPages: 200 },
): Promise<RasterisedPage[]> {
  if (!(await popplerAvailable())) return [];

  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'input.pdf');
    await writeFile(inputPath, buffer);

    const result = await run(
      'pdftoppm',
      [
        '-png',
        '-r',
        String(options.dpi ?? RENDER_DPI),
        '-f',
        '1',
        '-l',
        String(options.maxPages),
        '-cropbox',
        inputPath,
        join(dir, 'page'),
      ],
      { timeoutMs: RASTERISE_TIMEOUT_MS },
    );

    if (result.code !== 0 && result.timedOut) return [];

    const files = (await readdir(dir))
      .filter((entry) => entry.startsWith('page') && entry.endsWith('.png'))
      .sort((a, b) => pageNumberOf(a) - pageNumberOf(b));

    const pages: RasterisedPage[] = [];
    for (const file of files) {
      const png = await readFile(join(dir, file));
      // WebP at quality 82 is roughly a third the size of the PNG with no
      // visible difference on text, which matters for first-page latency.
      const image = sharp(png).resize({
        width: options.maxWidth ?? MAX_RENDER_WIDTH,
        withoutEnlargement: true,
        fit: 'inside',
      });
      const { data, info } = await image
        // A higher effort costs the worker a little CPU once and every reader
        // a smaller download for the life of the link.
        .webp({ quality: 82, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      pages.push({
        page: pageNumberOf(file),
        bytes: data,
        width: info.width,
        height: info.height,
      });
    }
    return pages;
  });
}

function pageNumberOf(filename: string): number {
  const match = /page[-_]?(\d+)/.exec(filename);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Renders one PDF page at high resolution for the page reader.
 *
 * Greyscale keeps the image small; the vision model gains nothing from colour
 * on a text page, and a smaller image is a cheaper request.
 */
export async function rasterisePageForOcr(
  buffer: Buffer,
  page: number,
  dpi = 300,
): Promise<Buffer | null> {
  if (!(await popplerAvailable())) return null;

  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'input.pdf');
    await writeFile(inputPath, buffer);
    // OCR accuracy improves markedly at 300 DPI; greyscale is enough for text.
    const result = await run(
      'pdftoppm',
      ['-png', '-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), inputPath, join(dir, 'ocr')],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) return null;
    const produced = (await readdir(dir)).find((entry) => entry.startsWith('ocr') && entry.endsWith('.png'));
    return produced ? readFile(join(dir, produced)) : null;
  });
}

/** Produces a small cover thumbnail for the file list. */
export async function makeThumbnail(imageBytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(imageBytes)
      .rotate()
      .resize({ width: 320, height: 420, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Re-encodes an uploaded image to a safe, web-friendly preview. */
export async function normaliseImage(
  imageBytes: Buffer,
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  try {
    const { data, info } = await sharp(imageBytes)
      .rotate()
      .resize({ width: 2_000, height: 2_000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Decodes any image to raw luminance at a given size.
 *
 * Fidelity comparison needs both images in the same space; the caller owns the
 * target size because it is comparing a delivered preview against a reference
 * render of the same page.
 */
export async function greyscaleRaw(
  imageBytes: Buffer,
  size: { width: number; height: number },
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  try {
    const { data, info } = await sharp(imageBytes)
      .resize({ width: size.width, height: size.height, fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  } catch {
    return null;
  }
}

/**
 * Renders one page losslessly, as the reference a delivered preview is judged
 * against. No resize and no lossy encode, so any difference found afterwards
 * belongs to the delivery pipeline rather than to the renderer.
 */
export async function renderReferencePage(
  buffer: Buffer,
  page: number,
  dpi = 150,
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  if (!(await popplerAvailable())) return null;

  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'input.pdf');
    await writeFile(inputPath, buffer);
    const result = await run(
      'pdftoppm',
      [
        '-png',
        '-r',
        String(dpi),
        '-f',
        String(page),
        '-l',
        String(page),
        '-cropbox',
        inputPath,
        join(dir, 'ref'),
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) return null;
    const produced = (await readdir(dir)).find(
      (entry) => entry.startsWith('ref') && entry.endsWith('.png'),
    );
    if (!produced) return null;
    const bytes = await readFile(join(dir, produced));
    const meta = await sharp(bytes).metadata();
    return { bytes, width: meta.width ?? 0, height: meta.height ?? 0 };
  });
}
