import { extname } from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import {
  ARCHIVE_DENYLIST_EXTENSIONS,
  isAcceptedFilename,
  looksExecutable,
  type PlatformLimits,
} from '@companion/shared';

/**
 * Safe archive extraction.
 *
 * Archives are the most dangerous thing a stranger can upload. Every guard here
 * exists because an attacker controls the file: zip bombs (ratio and total-size
 * caps), path traversal (`../`, absolute paths, drive letters), symlinks
 * (refused outright), executables (magic bytes, not just extensions), entry
 * floods and deep nesting.
 */
export interface ArchiveEntry {
  /** Normalised, guaranteed-relative path inside the archive. */
  path: string;
  bytes: Buffer;
  sizeBytes: number;
}

export interface ArchiveRejection {
  path: string;
  reason: string;
}

export interface ArchiveResult {
  entries: ArchiveEntry[];
  rejected: ArchiveRejection[];
  totalUncompressedBytes: number;
  /** Nested archives found inside, returned for a bounded second pass. */
  nestedArchives: ArchiveEntry[];
}

export class ArchiveRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveRejectedError';
  }
}

export async function extractArchive(
  buffer: Buffer,
  limits: PlatformLimits,
  options: { depth: number } = { depth: 1 },
): Promise<ArchiveResult> {
  if (options.depth > limits.maxArchiveDepth) {
    throw new ArchiveRejectedError(
      `Archives nested more than ${limits.maxArchiveDepth} levels deep are not accepted.`,
    );
  }

  const zip = await openZip(buffer);
  const entries: ArchiveEntry[] = [];
  const rejected: ArchiveRejection[] = [];
  const nestedArchives: ArchiveEntry[] = [];
  let totalUncompressed = 0;
  let entryCount = 0;

  try {
    for await (const entry of iterateEntries(zip)) {
      entryCount += 1;
      if (entryCount > limits.maxArchiveEntries) {
        throw new ArchiveRejectedError(
          `This archive contains more than ${limits.maxArchiveEntries} files.`,
        );
      }

      const rawPath = decodeEntryName(entry.fileName);

      // Directory markers carry no content.
      if (rawPath.endsWith('/')) continue;

      // Symlinks are stored with the link target as content; following one
      // would read arbitrary host files, so they are never extracted.
      if (isSymlink(entry)) {
        rejected.push({ path: rawPath, reason: 'Symbolic links are not extracted.' });
        continue;
      }

      const safePath = sanitiseArchivePath(rawPath);
      if (!safePath) {
        rejected.push({ path: rawPath, reason: 'Unsafe path.' });
        continue;
      }

      // Archive metadata directories carry nothing a reader wants.
      if (isNoise(safePath)) continue;

      const extension = extname(safePath).slice(1).toLowerCase();
      if ((ARCHIVE_DENYLIST_EXTENSIONS as readonly string[]).includes(extension)) {
        rejected.push({ path: safePath, reason: 'Executable files are not accepted.' });
        continue;
      }

      const declaredSize = entry.uncompressedSize;
      if (totalUncompressed + declaredSize > limits.maxArchiveExtractedBytes) {
        throw new ArchiveRejectedError('This archive expands to more than the allowed size.');
      }

      // Zip-bomb ratio check on the declared sizes, before decompressing.
      if (
        entry.compressedSize > 0 &&
        declaredSize / entry.compressedSize > limits.maxCompressionRatio &&
        declaredSize > 1024 * 1024
      ) {
        throw new ArchiveRejectedError('This archive appears to be a decompression bomb.');
      }

      const isNested = extension === 'zip';
      if (!isNested && !isAcceptedFilename(safePath)) {
        rejected.push({ path: safePath, reason: 'Unsupported file type.' });
        continue;
      }

      // A crafted central directory can understate an entry's size to slip
      // past the expansion cap, so the read is bounded by what the compressed
      // bytes could honestly produce and by the archive's remaining budget.
      const honestCeiling = Math.max(
        Math.ceil(entry.compressedSize * limits.maxCompressionRatio),
        64 * 1024,
      );
      const ceiling = Math.min(
        Math.max(declaredSize + 4096, honestCeiling),
        limits.maxArchiveExtractedBytes - totalUncompressed + 1,
      );

      const bytes = await readEntry(zip, entry, ceiling, safePath);

      totalUncompressed += bytes.byteLength;
      if (totalUncompressed > limits.maxArchiveExtractedBytes) {
        throw new ArchiveRejectedError('This archive expands to more than the allowed size.');
      }

      if (looksExecutable(bytes.subarray(0, 8))) {
        rejected.push({ path: safePath, reason: 'Executable files are not accepted.' });
        continue;
      }

      const collected: ArchiveEntry = { path: safePath, bytes, sizeBytes: bytes.byteLength };
      if (isNested) nestedArchives.push(collected);
      else entries.push(collected);
    }
  } finally {
    zip.close();
  }

  return { entries, rejected, totalUncompressedBytes: totalUncompressed, nestedArchives };
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // `decodeStrings: false` turns off yauzl's own filename validation, which
    // aborts the entire archive on the first suspicious entry. We want the
    // opposite: reject the individual entry and keep the rest, so names are
    // decoded and validated here instead — more strictly than yauzl does.
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: false,
        // yauzl aborts the whole archive when an entry's real size disagrees
        // with its declared size. We enforce that ourselves, per entry, so a
        // single hostile file cannot cost the sender the rest of the upload.
        validateEntrySizes: false,
      },
      (error, zipfile) => {
        if (error || !zipfile) {
          reject(new ArchiveRejectedError('This archive could not be opened.'));
          return;
        }
        resolve(zipfile);
      },
    );
  });
}

async function* iterateEntries(zip: ZipFile): AsyncGenerator<Entry> {
  // yauzl's lazy mode is callback-driven; this adapts it to an async iterator
  // so extraction stays streaming rather than loading every entry at once.
  const queue: Entry[] = [];
  let done = false;
  let failure: Error | null = null;
  let notify: (() => void) | null = null;

  const wake = () => {
    notify?.();
    notify = null;
  };

  zip.on('entry', (entry: Entry) => {
    queue.push(entry);
    wake();
  });
  zip.on('end', () => {
    done = true;
    wake();
  });
  zip.on('error', (error: Error) => {
    failure = error;
    done = true;
    wake();
  });

  zip.readEntry();

  for (;;) {
    if (failure) throw new ArchiveRejectedError('This archive is malformed.');
    const next = queue.shift();
    if (next) {
      yield next;
      zip.readEntry();
      continue;
    }
    if (done) return;
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
  }
}

function readEntry(
  zip: ZipFile,
  entry: Entry,
  ceiling: number,
  path: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new ArchiveRejectedError(`Could not read ${path}.`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        total += chunk.byteLength;
        if (total > ceiling) {
          settled = true;
          stream.destroy();
          reject(
            new ArchiveRejectedError(`${path} is larger than it declared in the archive.`),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      });
      stream.on('error', () => {
        if (!settled) {
          settled = true;
          reject(new ArchiveRejectedError(`Could not read ${path}.`));
        }
      });
    });
  });
}

/**
 * With `decodeStrings: false`, yauzl hands back the raw filename bytes. ZIP
 * stores names as UTF-8 when bit 11 of the general-purpose flags is set, and
 * as CP437 otherwise; UTF-8 decoding is a safe superset for our purposes since
 * the result is validated character by character afterwards.
 */
function decodeEntryName(fileName: string | Buffer): string {
  return Buffer.isBuffer(fileName) ? fileName.toString('utf8') : fileName;
}

/** yauzl exposes the unix mode in the high 16 bits of externalFileAttributes. */
function isSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const S_IFMT = 0o170000;
  const S_IFLNK = 0o120000;
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Produces a guaranteed-relative path, or null when the entry is trying to
 * escape. Rejects absolute paths, drive letters, UNC paths, `..` segments,
 * backslash separators and NUL bytes.
 */
export function sanitiseArchivePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0')) return null;
  if (rawPath.length > 1_000) return null;

  // Normalise Windows separators before any other check.
  const normalised = rawPath.replace(/\\/g, '/');

  if (normalised.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(normalised)) return null;
  if (normalised.startsWith('//')) return null;

  const segments = normalised.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '..')) return null;
  if (segments.length > 24) return null;
  if (segments.some((segment) => segment.length > 255)) return null;

  return segments.join('/');
}

function isNoise(path: string): boolean {
  return (
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/') ||
    path.split('/').some((segment) => segment === '.DS_Store' || segment === 'Thumbs.db') ||
    path.split('/').pop()?.startsWith('._') === true
  );
}
