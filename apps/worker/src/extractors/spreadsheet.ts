import ExcelJS from 'exceljs';
import { normaliseWhitespace } from '@companion/ai';
import { EMPTY_EXTRACTION, type ExtractedUnit, type ExtractionResult } from './types.js';

/**
 * Spreadsheets.
 *
 * A sheet is chunked into row bands rather than treated as one blob, so a
 * citation can point at "Forecast sheet · B12:F20" instead of a whole file.
 * The header row is repeated on every band so a band read in isolation still
 * says what its columns mean.
 */
const ROWS_PER_BAND = 40;
const MAX_COLUMNS = 40;
const MAX_ROWS = 5_000;

export interface SheetPreviewModel {
  sheets: {
    name: string;
    columns: string[];
    rows: (string | number | null)[][];
    truncated: boolean;
  }[];
}

export async function extractSpreadsheet(
  buffer: Buffer,
): Promise<ExtractionResult & { preview: SheetPreviewModel }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      ...EMPTY_EXTRACTION,
      notes: ['This spreadsheet could not be read.'],
      preview: { sheets: [] },
    };
  }

  const units: ExtractedUnit[] = [];
  const preview: SheetPreviewModel = { sheets: [] };
  const notes: string[] = [];
  let ordinal = 0;

  workbook.eachSheet((worksheet) => {
    const sheetName = worksheet.name;
    const rows: (string | number | null)[][] = [];
    let truncated = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) {
        truncated = true;
        return;
      }
      const values: (string | number | null)[] = [];
      for (let column = 1; column <= Math.min(worksheet.columnCount, MAX_COLUMNS); column += 1) {
        values.push(readCell(row.getCell(column)));
      }
      // Skip rows that are entirely empty after the column cap.
      if (values.some((value) => value !== null && value !== '')) rows.push(values);
    });

    if (rows.length === 0) return;

    const header = (rows[0] ?? []).map((value) => (value === null ? '' : String(value)));
    const headerLooksLikeLabels = header.filter((value) => value.trim().length > 0).length >= 2;
    const headerLine = headerLooksLikeLabels ? header.join(' | ') : '';

    preview.sheets.push({
      name: sheetName,
      columns: header,
      rows: rows.slice(0, 500),
      truncated: truncated || rows.length > 500,
    });

    const bodyStart = headerLooksLikeLabels ? 1 : 0;
    for (let start = bodyStart; start < rows.length; start += ROWS_PER_BAND) {
      const band = rows.slice(start, start + ROWS_PER_BAND);
      const lines = band
        .map((row) =>
          row
            .map((value) => (value === null ? '' : String(value)))
            .join(' | ')
            .replace(/(\s*\|\s*)+$/, ''),
        )
        .filter((line) => line.replace(/[\s|]/g, '').length > 0);
      if (lines.length === 0) continue;

      const firstRow = start + 1;
      const lastRow = start + band.length;
      const lastColumn = columnLetter(Math.min(header.length || 1, MAX_COLUMNS));
      const range = `A${firstRow}:${lastColumn}${lastRow}`;

      ordinal += 1;
      units.push({
        kind: 'SHEET',
        ordinal,
        page: null,
        slide: null,
        sheetName,
        range,
        sectionTitle: sheetName,
        text: normaliseWhitespace(
          headerLine ? `${sheetName} · ${range}\n${headerLine}\n${lines.join('\n')}` : `${sheetName} · ${range}\n${lines.join('\n')}`,
        ),
      });
    }

    if (truncated) notes.push(`Only the first ${MAX_ROWS} rows of "${sheetName}" were indexed.`);
  });

  return { units, pageCount: preview.sheets.length, usedOcr: false, notes, preview };
}

function readCell(cell: ExcelJS.Cell): string | number | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;
    // A formula cell carries its computed result, which is what a reader wants.
    if ('result' in record) {
      const result = record['result'];
      if (typeof result === 'number' || typeof result === 'string') return result;
      return null;
    }
    if ('richText' in record && Array.isArray(record['richText'])) {
      return (record['richText'] as { text?: string }[]).map((part) => part.text ?? '').join('');
    }
    if ('text' in record && typeof record['text'] === 'string') return record['text'];
    if ('error' in record) return null;
  }
  return null;
}

function columnLetter(index: number): string {
  let value = index;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters || 'A';
}

/** CSV and TSV: parsed directly, no conversion step. */
export function extractDelimited(
  content: string,
  delimiter: ',' | '\t',
  name: string,
): ExtractionResult & { preview: SheetPreviewModel } {
  const rows = parseDelimited(content, delimiter).slice(0, MAX_ROWS);
  if (rows.length === 0) {
    return { ...EMPTY_EXTRACTION, preview: { sheets: [] } };
  }

  const header = rows[0] ?? [];
  const headerLine = header.join(' | ');
  const units: ExtractedUnit[] = [];

  for (let start = 1; start < rows.length; start += ROWS_PER_BAND) {
    const band = rows.slice(start, start + ROWS_PER_BAND);
    const lines = band.map((row) => row.join(' | ')).filter((line) => line.replace(/[\s|]/g, ''));
    if (lines.length === 0) continue;
    const range = `A${start + 1}:${columnLetter(header.length || 1)}${start + band.length}`;
    units.push({
      kind: 'SHEET',
      ordinal: units.length + 1,
      page: null,
      slide: null,
      sheetName: name,
      range,
      sectionTitle: name,
      text: normaliseWhitespace(`${name} · ${range}\n${headerLine}\n${lines.join('\n')}`),
    });
  }

  return {
    units,
    pageCount: 1,
    usedOcr: false,
    notes: [],
    preview: {
      sheets: [{ name, columns: header, rows: rows.slice(0, 500), truncated: rows.length > 500 }],
    },
  };
}

/** Minimal RFC-4180 parser: handles quoting, escaped quotes and embedded newlines. */
export function parseDelimited(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] as string;

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}
