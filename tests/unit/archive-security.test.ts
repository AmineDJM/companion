import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATFORM_LIMITS, looksExecutable, signatureMatchesExtension } from '@companion/shared';
import { sanitiseArchivePath, extractArchive, ArchiveRejectedError } from '../../apps/worker/src/lib/archive.js';
import { buildZip } from './helpers/zip';

describe('archive path sanitisation', () => {
  it.each([
    '../../etc/passwd',
    '../secret.pdf',
    '/etc/passwd',
    'C:\\Windows\\System32\\config',
    '..\\..\\windows\\system.ini',
    '//server/share/file.pdf',
    'a/../../b.pdf',
  ])('refuses a traversal attempt: %s', (path) => {
    expect(sanitiseArchivePath(path)).toBeNull();
  });

  it('refuses a NUL byte in the path', () => {
    expect(sanitiseArchivePath('good\0../../evil.pdf')).toBeNull();
  });

  it('normalises Windows separators to a relative POSIX path', () => {
    expect(sanitiseArchivePath('Security\\Policies\\policy.pdf')).toBe(
      'Security/Policies/policy.pdf',
    );
  });

  it('keeps a legitimate nested path', () => {
    expect(sanitiseArchivePath('./Security/policy.pdf')).toBe('Security/policy.pdf');
  });

  it('refuses an absurdly deep path', () => {
    expect(sanitiseArchivePath(Array.from({ length: 40 }, () => 'a').join('/') + '/x.pdf')).toBeNull();
  });
});

describe('executable detection', () => {
  it.each([
    ['Windows PE', [0x4d, 0x5a, 0x90, 0x00]],
    ['ELF', [0x7f, 0x45, 0x4c, 0x46]],
    ['Mach-O', [0xfe, 0xed, 0xfa, 0xcf]],
    ['Java class', [0xca, 0xfe, 0xba, 0xbe]],
  ])('detects %s regardless of extension', (_name, bytes) => {
    expect(looksExecutable(new Uint8Array(bytes))).toBe(true);
  });

  it('does not flag a PDF', () => {
    expect(looksExecutable(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false);
  });
});

describe('magic byte verification', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const MZ = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

  it('accepts a real PDF named .pdf', () => {
    expect(signatureMatchesExtension('pdf', PDF)).toBe(true);
  });

  it('refuses an executable renamed to .pdf', () => {
    expect(signatureMatchesExtension('pdf', MZ)).toBe(false);
  });

  it('refuses a PNG renamed to .pdf', () => {
    expect(signatureMatchesExtension('pdf', PNG)).toBe(false);
  });

  it('accepts OOXML, which is legitimately a ZIP container', () => {
    expect(signatureMatchesExtension('docx', ZIP)).toBe(true);
    expect(signatureMatchesExtension('xlsx', ZIP)).toBe(true);
    expect(signatureMatchesExtension('pptx', ZIP)).toBe(true);
    expect(signatureMatchesExtension('zip', ZIP)).toBe(true);
  });

  it('refuses a ZIP renamed to .txt, since text has no signature', () => {
    expect(signatureMatchesExtension('txt', ZIP)).toBe(false);
  });
});

describe('archive extraction', () => {
  it('extracts safe entries and preserves the folder hierarchy', async () => {
    const zip = buildZip([
      { path: 'Security/policy.md', content: '# Security policy\n' },
      { path: 'README.txt', content: 'read me' },
    ]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      'README.txt',
      'Security/policy.md',
    ]);
  });

  it('rejects a traversal entry without failing the whole archive', async () => {
    const zip = buildZip([
      { path: 'good.txt', content: 'fine' },
      { path: '../../evil.txt', content: 'bad' },
    ]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path)).toEqual(['good.txt']);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects an executable by extension and by content', async () => {
    const zip = buildZip([
      { path: 'setup.exe', content: 'MZ\u0090\u0000' },
      { path: 'safe.txt', content: 'ok' },
    ]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path)).toEqual(['safe.txt']);
    expect(result.rejected[0]?.reason).toMatch(/Executable/);
  });

  it('skips unsupported file types', async () => {
    const zip = buildZip([{ path: 'data.sqlite', content: 'binary' }]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/Unsupported/);
  });

  it('ignores archive metadata directories', async () => {
    const zip = buildZip([
      { path: '__MACOSX/._doc.pdf', content: 'junk' },
      { path: '.DS_Store', content: 'junk' },
      { path: 'real.txt', content: 'content' },
    ]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path)).toEqual(['real.txt']);
  });

  it('refuses an archive nested deeper than the configured limit', async () => {
    const zip = buildZip([{ path: 'a.txt', content: 'x' }]);
    await expect(
      extractArchive(zip, { ...DEFAULT_PLATFORM_LIMITS, maxArchiveDepth: 2 }, { depth: 3 }),
    ).rejects.toBeInstanceOf(ArchiveRejectedError);
  });

  it('refuses an archive with too many entries', async () => {
    const zip = buildZip(
      Array.from({ length: 12 }, (_, index) => ({ path: `file-${index}.txt`, content: 'x' })),
    );
    await expect(
      extractArchive(zip, { ...DEFAULT_PLATFORM_LIMITS, maxArchiveEntries: 5 }, { depth: 1 }),
    ).rejects.toThrow(/more than 5 files/);
  });

  it('refuses an archive that expands beyond the size cap', async () => {
    const zip = buildZip([{ path: 'big.txt', content: 'a'.repeat(50_000) }]);
    await expect(
      extractArchive(
        zip,
        { ...DEFAULT_PLATFORM_LIMITS, maxArchiveExtractedBytes: 1_000 },
        { depth: 1 },
      ),
    ).rejects.toThrow(/allowed size/);
  });

  it('refuses a decompression bomb by compression ratio', async () => {
    // Highly compressible content: megabytes of zeros in a tiny archive.
    const zip = buildZip([{ path: 'bomb.txt', content: '\u0000'.repeat(4 * 1024 * 1024) }], {
      compress: true,
    });
    await expect(
      extractArchive(zip, { ...DEFAULT_PLATFORM_LIMITS, maxCompressionRatio: 50 }, { depth: 1 }),
    ).rejects.toThrow(/bomb/);
  });

  it('collects nested archives for a bounded second pass', async () => {
    const inner = buildZip([{ path: 'deep.txt', content: 'deep' }]);
    const outer = buildZip([
      { path: 'nested.zip', content: inner },
      { path: 'top.txt', content: 'top' },
    ]);
    const result = await extractArchive(outer, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path)).toEqual(['top.txt']);
    expect(result.nestedArchives.map((entry) => entry.path)).toEqual(['nested.zip']);
  });

  it('never extracts a symbolic link', async () => {
    // A symlink entry stores its target as content; following one would read
    // arbitrary host files.
    const zip = buildZip([
      { path: 'link.txt', content: '/etc/passwd', symlink: true },
      { path: 'real.txt', content: 'fine' },
    ]);
    const result = await extractArchive(zip, DEFAULT_PLATFORM_LIMITS, { depth: 1 });
    expect(result.entries.map((entry) => entry.path)).toEqual(['real.txt']);
    expect(result.rejected[0]?.reason).toMatch(/Symbolic/);
  });

  it('refuses a compressed entry that understates its uncompressed size', async () => {
    // The real attack: declare a tiny uncompressed size so the pre-read ratio
    // check passes, then expand hugely on the stream. The read is bounded by
    // what the compressed bytes could honestly produce, so it is cut short.
    const zip = buildZip([{ path: 'liar.txt', content: '\u0000'.repeat(4 * 1024 * 1024), declaredSize: 10 }], {
      compress: true,
    });
    await expect(
      extractArchive(zip, { ...DEFAULT_PLATFORM_LIMITS, maxCompressionRatio: 20 }, { depth: 1 }),
    ).rejects.toThrow(/larger than it declared/);
  });

  it('refuses a malformed archive', async () => {
    await expect(
      extractArchive(Buffer.from('not a zip at all'), DEFAULT_PLATFORM_LIMITS, { depth: 1 }),
    ).rejects.toBeInstanceOf(ArchiveRejectedError);
  });
});
