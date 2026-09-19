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
  doc: {
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
  odt: {
    mimeType: 'application/vnd.oasis.opendocument.text',
    kind: 'WORD',
    requiresConversion: true,
    nativeText: false,
  },
  rtf: { mimeType: 'application/rtf', kind: 'WORD', requiresConversion: true, nativeText: false },
  ppt: {
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
  odp: {
    mimeType: 'application/vnd.oasis.opendocument.presentation',
    kind: 'SLIDES',
    requiresConversion: true,
    nativeText: false,
  },
  xls: {
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
  ods: {
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
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
  txt: { mimeType: 'text/plain', kind: 'TEXT', requiresConversion: false, nativeText: true },
  md: { mimeType: 'text/markdown', kind: 'TEXT', requiresConversion: false, nativeText: true },
  png: { mimeType: 'image/png', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  jpg: { mimeType: 'image/jpeg', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  jpeg: { mimeType: 'image/jpeg', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  gif: { mimeType: 'image/gif', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  webp: { mimeType: 'image/webp', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  bmp: { mimeType: 'image/bmp', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  tif: { mimeType: 'image/tiff', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  tiff: { mimeType: 'image/tiff', kind: 'IMAGE', requiresConversion: false, nativeText: false },
  heic: { mimeType: 'image/heic', kind: 'IMAGE', requiresConversion: false, nativeText: false },
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
    // Text-like formats legitimately have no signature.
    return info.kind === 'TEXT' || info.kind === 'SPREADSHEET' || info.kind === 'WORD';
  }
  if (info.kind === 'TEXT') return false;
  if (sniffed === 'ARCHIVE') {
    // OOXML and ODF are ZIP containers; so is a genuine .zip.
    return ['ARCHIVE', 'WORD', 'SLIDES', 'SPREADSHEET'].includes(info.kind);
  }
  if (sniffed === 'WORD') {
    // Legacy OLE2 container backs .doc, .xls and .ppt alike.
    return ['WORD', 'SLIDES', 'SPREADSHEET'].includes(info.kind);
  }
  return sniffed === info.kind;
}
