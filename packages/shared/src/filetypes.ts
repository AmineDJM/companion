import type { DocumentKind } from './constants.js';
import { ACCEPTED_EXTENSIONS, type AcceptedExtension } from './limits.js';

export interface FileTypeInfo {
  extension: string;
  mimeType: string;
  kind: DocumentKind;
  /** True when the file must be converted to PDF before a preview can exist. */
  requiresConversion: boolean;
  /** True when the extractor can read text directly without conversion. */
  nativeText: boolean;
}

const REGISTRY: Record<string, Omit<FileTypeInfo, 'extension'>> = {
  pdf: { mimeType: 'application/pdf', kind: 'PDF', requiresConversion: false, nativeText: true },

  // ── Word processing ───────────────────────────────────────────────────────
  // Legacy binary, modern OOXML, their macro and template variants, and the
  // OpenDocument family. LibreOffice reads all of them; only .docx is parsed
  // natively, because that is the one whose text we can extract faster and
  // more accurately than a PDF round trip.
  doc: {
    mimeType: 'application/msword',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },
  dot: {
    mimeType: 'application/msword',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },
  docx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: true,
  },
  docm: {
    // Macro-enabled. The macros are never executed: the file is converted to
    // PDF in a headless process and the original is only ever handed back
    // untouched, exactly as it was uploaded.
    mimeType: 'application/vnd.ms-word.document.macroEnabled.12',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: true,
  },
  dotx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: true,
  },
  odt: {
    mimeType: 'application/vnd.oasis.opendocument.text',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },
  ott: {
    mimeType: 'application/vnd.oasis.opendocument.text-template',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },
  rtf: { mimeType: 'application/rtf', kind: 'WORD', requiresConversion: true, nativeText: false },
  epub: {
    mimeType: 'application/epub+zip',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },

  // ── Presentations ─────────────────────────────────────────────────────────
  ppt: {
    mimeType: 'application/vnd.ms-powerpoint',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },
  pps: {
    // A slideshow is a .ppt that opens in presentation mode; same container.
    mimeType: 'application/vnd.ms-powerpoint',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },
  pptx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: true,
  },
  pptm: {
    mimeType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: true,
  },
  ppsx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: true,
  },
  potx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.template',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: true,
  },
  odp: {
    mimeType: 'application/vnd.oasis.opendocument.presentation',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },
  otp: {
    mimeType: 'application/vnd.oasis.opendocument.presentation-template',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },

  // ── Spreadsheets ──────────────────────────────────────────────────────────
  xls: {
    mimeType: 'application/vnd.ms-excel',
    kind: 'SPREADSHEET',
    requiresConversion: true,
    nativeText: false,
  },
  xlt: {
    mimeType: 'application/vnd.ms-excel',
    kind: 'SPREADSHEET',
    requiresConversion: true,
    nativeText: false,
  },
  xlsx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'SPREADSHEET',
    requiresConversion: false,
    nativeText: true,
  },
  xlsm: {
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    kind: 'SPREADSHEET',
    requiresConversion: false,
    nativeText: true,
  },
  xltx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    kind: 'SPREADSHEET',
    requiresConversion: false,
    nativeText: true,
  },
  ods: {
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    kind: 'SPREADSHEET',
    requiresConversion: true,
    nativeText: false,
  },
  ots: {
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet-template',
    kind: 'SPREADSHEET',
    requiresConversion: true,
    nativeText: false,
  },
  csv: { mimeType: 'text/csv', kind: 'SPREADSHEET', requiresConversion: false, nativeText: true },
  tsv: {
    mimeType: 'text/tab-separated-values',
    kind: 'SPREADSHEET',
    requiresConversion: false,
    nativeText: true,
  },

  // ── Drawings ──────────────────────────────────────────────────────────────
  odg: {
    mimeType: 'application/vnd.oasis.opendocument.graphics',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },

  // ── Plain text ────────────────────────────────────────────────────────────
  txt: { mimeType: 'text/plain', kind: 'TEXT', requiresConversion: false, nativeText: true },
  md: { mimeType: 'text/markdown', kind: 'TEXT', requiresConversion: false, nativeText: true },
  markdown: {
    mimeType: 'text/markdown',
    kind: 'TEXT',
    requiresConversion: false,
    nativeText: true,
  },
  json: { mimeType: 'application/json', kind: 'TEXT', requiresConversion: false, nativeText: true },
  xml: { mimeType: 'application/xml', kind: 'TEXT', requiresConversion: false, nativeText: true },
  yaml: { mimeType: 'text/yaml', kind: 'TEXT', requiresConversion: false, nativeText: true },
  yml: { mimeType: 'text/yaml', kind: 'TEXT', requiresConversion: false, nativeText: true },
  log: { mimeType: 'text/plain', kind: 'TEXT', requiresConversion: false, nativeText: true },

  // ── Images ────────────────────────────────────────────────────────────────
  png: { mimeType: 'image/png', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  jpg: { mimeType: 'image/jpeg', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  jpeg: { mimeType: 'image/jpeg', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  gif: { mimeType: 'image/gif', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  webp: { mimeType: 'image/webp', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  bmp: { mimeType: 'image/bmp', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  tif: { mimeType: 'image/tiff', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  tiff: { mimeType: 'image/tiff', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  heic: { mimeType: 'image/heic', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  heif: { mimeType: 'image/heif', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  avif: { mimeType: 'image/avif', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  svg: {
    // Rasterised on ingestion like any other image, so no markup it carries
    // is ever handed to a browser.
    mimeType: 'image/svg+xml',
    kind: 'IMAGE',
    requiresConversion: false,
    nativeText: false,
  },
  zip: {
    mimeType: 'application/zip',
    kind: 'ARCHIVE',
    requiresConversion: false,
    nativeText: false,
  },
};

export function extensionOf(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function describeFile(filename: string): FileTypeInfo {
  const extension = extensionOf(filename);
  const entry = REGISTRY[extension];
  if (!entry) {
    return {
      extension,
      mimeType: 'application/octet-stream',
      kind: 'UNKNOWN',
      requiresConversion: false,
      nativeText: false,
    };
  }
  return { extension, ...entry };
}

export function isAcceptedExtension(extension: string): extension is AcceptedExtension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isAcceptedFilename(filename: string): boolean {
  return isAcceptedExtension(extensionOf(filename));
}

export function isArchive(filename: string): boolean {
  return describeFile(filename).kind === 'ARCHIVE';
}

/** The `accept` attribute for the universal dropzone. */
export const DROPZONE_ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/**
 * Magic-byte signatures. Extensions are never trusted on ingestion; the worker
 * sniffs the header and refuses files whose real container disagrees.
 */
const SIGNATURES: { kind: DocumentKind; bytes: number[]; offset: number }[] = [
  { kind: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }, // %PDF
  { kind: 'ARCHIVE', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 }, // PK.. (also OOXML)
  { kind: 'ARCHIVE', bytes: [0x50, 0x4b, 0x05, 0x06], offset: 0 },
  { kind: 'ARCHIVE', bytes: [0x50, 0x4b, 0x07, 0x08], offset: 0 },
  { kind: 'IMAGE', bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 }, // PNG
  { kind: 'IMAGE', bytes: [0xff, 0xd8, 0xff], offset: 0 }, // JPEG
  { kind: 'IMAGE', bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 }, // GIF8
  { kind: 'IMAGE', bytes: [0x42, 0x4d], offset: 0 }, // BMP
  { kind: 'WORD', bytes: [0xd0, 0xcf, 0x11, 0xe0], offset: 0 }, // legacy OLE2 (doc/xls/ppt)
  { kind: 'IMAGE', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF (WebP)
  { kind: 'IMAGE', bytes: [0x49, 0x49, 0x2a, 0x00], offset: 0 }, // TIFF little-endian
  { kind: 'IMAGE', bytes: [0x4d, 0x4d, 0x00, 0x2a], offset: 0 }, // TIFF big-endian
  { kind: 'IMAGE', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ISO-BMFF: HEIC, HEIF, AVIF
];

/** Executable signatures that are refused outright, whatever the extension. */
const EXECUTABLE_SIGNATURES: number[][] = [
  [0x4d, 0x5a], // MZ - Windows PE
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O reverse
  [0xca, 0xfe, 0xba, 0xbe], // Java class / fat binary
];

function matches(header: Uint8Array, bytes: number[], offset: number): boolean {
  if (header.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => header[offset + index] === byte);
}

export function sniffKind(header: Uint8Array): DocumentKind | null {
  for (const signature of SIGNATURES) {
    if (matches(header, signature.bytes, signature.offset)) return signature.kind;
  }
  return null;
}

export function looksExecutable(header: Uint8Array): boolean {
  return EXECUTABLE_SIGNATURES.some((bytes) => matches(header, bytes, 0));
}

/**
 * Confirms that the declared extension is compatible with the real container.
 * OOXML files (docx/xlsx/pptx) are ZIP containers, so ZIP magic is accepted for
 * them; plain-text formats have no reliable signature and are always allowed.
 */
export function signatureMatchesExtension(extension: string, header: Uint8Array): boolean {
  const info = REGISTRY[extension.toLowerCase()];
  if (!info) return false;
  if (looksExecutable(header)) return false;
  const sniffed = sniffKind(header);
  if (sniffed === null) {
    // Text-like formats legitimately have no signature, and so does SVG,
    // which is XML however it is labelled.
    if (extension.toLowerCase() === 'svg') return true;
    return info.kind === 'TEXT' || info.kind === 'SPREADSHEET' || info.kind === 'WORD';
  }
  // A text extension must not be carrying a binary container.
  if (info.kind === 'TEXT') return false;
  if (sniffed === 'ARCHIVE') {
    // OOXML, ODF and EPUB are all ZIP containers; so is a genuine .zip.
    // Which one it really is, the extractor decides by reading the manifest.
    return ['ARCHIVE', 'WORD', 'SLIDES', 'SPREADSHEET'].includes(info.kind);
  }
  if (sniffed === 'WORD') {
    // Legacy OLE2 container backs .doc, .xls and .ppt alike.
    return ['WORD', 'SLIDES', 'SPREADSHEET'].includes(info.kind);
  }
  return sniffed === info.kind;
}
