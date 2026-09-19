import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_EXTENSIONS,
  describeFile,
  isAcceptedFilename,
  signatureMatchesExtension,
  updateCompanionSchema,
} from '@companion/shared';

/**
 * What a sender is allowed to drop on the dropzone.
 *
 * The promise is "any document", and the formats people actually have on disk
 * are not the ones a 2020 file picker suggests: a board pack arrives as a .ppt
 * from 2006, a contract as a .doc, a budget as a macro-enabled .xlsm. Refusing
 * those is refusing the customer's real filing cabinet.
 */
const OOXML_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

describe('presentations', () => {
  it('accepts every PowerPoint generation and its variants', () => {
    for (const name of ['deck.ppt', 'deck.pptx', 'deck.pptm', 'show.pps', 'show.ppsx', 'brand.potx']) {
      expect(isAcceptedFilename(name), name).toBe(true);
      expect(describeFile(name).kind, name).toBe('SLIDES');
    }
  });

  it('accepts the OpenDocument equivalents', () => {
    for (const name of ['deck.odp', 'template.otp', 'diagram.odg']) {
      expect(describeFile(name).kind, name).toBe('SLIDES');
    }
  });

  it('sends every deck through conversion, so a 2003 file previews like a 2024 one', () => {
    for (const name of ['deck.ppt', 'deck.pptx', 'deck.odp']) {
      expect(describeFile(name).requiresConversion, name).toBe(true);
    }
  });
});

describe('word processing', () => {
  it('accepts legacy, modern, macro-enabled, template and OpenDocument', () => {
    for (const name of ['memo.doc', 'memo.dot', 'memo.docx', 'memo.docm', 'memo.dotx', 'memo.odt', 'memo.ott', 'memo.rtf']) {
      expect(isAcceptedFilename(name), name).toBe(true);
      expect(describeFile(name).kind, name).toBe('WORD');
    }
  });
});

describe('spreadsheets', () => {
  it('accepts legacy, modern, macro-enabled and template', () => {
    for (const name of ['budget.xls', 'budget.xlt', 'budget.xlsx', 'budget.xlsm', 'budget.xltx', 'budget.ods', 'budget.ots']) {
      expect(describeFile(name).kind, name).toBe('SPREADSHEET');
    }
  });

  it('reads the OOXML family natively rather than through a PDF', () => {
    // These keep their cell structure, which a rendered page would lose.
    for (const name of ['budget.xlsx', 'budget.xlsm', 'budget.xltx']) {
      expect(describeFile(name).requiresConversion, name).toBe(false);
    }
    // The 1997 binary has no such reader, so it goes through LibreOffice.
    expect(describeFile('budget.xls').requiresConversion).toBe(true);
  });
});

describe('signature checks', () => {
  it('accepts a ZIP container for every OOXML and ODF extension', () => {
    for (const extension of ['docx', 'docm', 'dotx', 'pptx', 'pptm', 'ppsx', 'potx', 'xlsx', 'xlsm', 'odt', 'odp', 'ods', 'epub']) {
      expect(signatureMatchesExtension(extension, OOXML_ZIP), extension).toBe(true);
    }
  });

  it('accepts the legacy OLE2 container for the formats built on it', () => {
    for (const extension of ['doc', 'ppt', 'pps', 'xls']) {
      expect(signatureMatchesExtension(extension, OLE2), extension).toBe(true);
    }
  });

  it('refuses a container that disagrees with the extension', () => {
    // A PDF renamed to .docx is not a Word file, whatever the name says.
    expect(signatureMatchesExtension('docx', PDF)).toBe(false);
    expect(signatureMatchesExtension('pptx', PDF)).toBe(false);
  });

  it('refuses an executable however it is named', () => {
    for (const extension of ['pptx', 'doc', 'pdf', 'xlsx', 'zip']) {
      expect(signatureMatchesExtension(extension, PE), extension).toBe(false);
    }
  });

  it('refuses a binary container wearing a text extension', () => {
    expect(signatureMatchesExtension('txt', OLE2)).toBe(false);
    expect(signatureMatchesExtension('json', PDF)).toBe(false);
  });
});

describe('the accepted list and the registry agree', () => {
  it('describes every extension the dropzone advertises', () => {
    for (const extension of ACCEPTED_EXTENSIONS) {
      // An extension offered but not described would be accepted on upload and
      // then fail in the worker as UNKNOWN.
      expect(describeFile(`file.${extension}`).kind, extension).not.toBe('UNKNOWN');
    }
  });

  it('refuses what it does not describe', () => {
    for (const name of ['thing.exe', 'thing.dmg', 'thing.iso', 'thing']) {
      expect(isAcceptedFilename(name), name).toBe(false);
    }
  });
});

describe('updateCompanionSchema', () => {
  it('accepts the fields it owns', () => {
    expect(updateCompanionSchema.safeParse({ name: 'Q3 board pack' }).success).toBe(true);
  });

  it('rejects an access-policy field instead of silently discarding it', () => {
    // Zod strips unknown keys by default, which once let a download toggle
    // report success while changing nothing at all.
    const result = updateCompanionSchema.safeParse({ downloadAllowed: true });
    expect(result.success).toBe(false);
  });
});
