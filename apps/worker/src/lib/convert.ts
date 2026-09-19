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
 */
const LIBREOFFICE_TIMEOUT_MS = 180_000;
const RASTERISE_TIMEOUT_MS = 240_000;

export async function libreOfficeAvailable(): Promise<boolean> {
  return (await isAvailable('soffice')) || (await isAvailable('libreoffice'));
}

export async function popplerAvailable(): Promise<boolean> {
  return isAvailable('pdftoppm');
}

export async function tesseractAvailable(): Promise<boolean> {
  return isAvailable('tesseract');
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
 * 150 DPI is the point where text stays crisp at 100% zoom without the file
 * sizes that make a viewer feel slow.
 */
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
        String(options.dpi ?? 150),
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
        width: options.maxWidth ?? 1_600,
        withoutEnlargement: true,
        fit: 'inside',
      });
      const { data, info } = await image
        .webp({ quality: 82, effort: 4 })
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

/** Renders one PDF page at higher DPI, for OCR input. */
export async function rasterisePageForOcr(
  buffer: Buffer,
  page: number,
): Promise<Buffer | null> {
  if (!(await popplerAvailable())) return null;

  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'input.pdf');
    await writeFile(inputPath, buffer);
    // OCR accuracy improves markedly at 300 DPI; greyscale is enough for text.
    const result = await run(
      'pdftoppm',
      ['-png', '-gray', '-r', '300', '-f', String(page), '-l', String(page), inputPath, join(dir, 'ocr')],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) return null;
    const produced = (await readdir(dir)).find((entry) => entry.startsWith('ocr') && entry.endsWith('.png'));
    return produced ? readFile(join(dir, produced)) : null;
  });
}

/** Runs OCR over an image. Returns null when Tesseract is not installed. */
export async function ocrImage(
  imageBytes: Buffer,
  languages = 'eng',
): Promise<string | null> {
  if (!(await tesseractAvailable())) return null;

  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'input.png');
    // Normalising to greyscale PNG first makes Tesseract's job easier and
    // sidesteps formats it handles poorly (HEIC, exotic TIFF variants).
    const normalised = await sharp(imageBytes)
      .rotate()
      .greyscale()
      .normalise()
      .png()
      .toBuffer()
      .catch(() => null);
    if (!normalised) return null;
    await writeFile(inputPath, normalised);

    const result = await run(
      'tesseract',
      [inputPath, join(dir, 'out'), '-l', languages, '--psm', '3'],
      { timeoutMs: 90_000 },
    );
    if (result.code !== 0) return null;

    return readFile(join(dir, 'out.txt'), 'utf8').catch(() => null);
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
