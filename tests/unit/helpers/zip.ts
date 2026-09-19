import { deflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP writer for tests.
 *
 * Built by hand rather than with a library so a test can produce genuinely
 * hostile archives — traversal paths, lying sizes, extreme ratios — that a
 * well-behaved writer would refuse to emit.
 */
export interface ZipEntryInput {
  path: string;
  content: string | Buffer;
  /** Overrides the uncompressed size written to the headers. */
  declaredSize?: number;
  /** Marks the entry as a symbolic link in the external attributes. */
  symlink?: boolean;
}

function crc32(buffer: Buffer): number {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  return (crc ^ -1) >>> 0;
}
crc32.table = undefined as Int32Array | undefined;

export function buildZip(
  entries: ZipEntryInput[],
  options: { compress?: boolean } = {},
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const compressed = options.compress ? deflateRawSync(raw) : raw;
    const method = options.compress ? 8 : 0;
    const declaredSize = entry.declaredSize ?? raw.byteLength;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // High 16 bits are the unix mode; 0120000 marks a symbolic link. The
    // shift is coerced back to unsigned because it overflows a signed int32.
    const mode = entry.symlink ? 0o120777 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, end]);
}
