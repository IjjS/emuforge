// The archive "Create Event Function" sends as `Code.ZipFile` (issue 84, requirement R6.5): one file, stored without
// compression, built in the browser. Nothing else is in it.

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

/** Version 2.0 of the format, made on Unix (the high byte, 3), so the file's mode below is read. */
const VERSION = 20;
const MADE_BY_UNIX = (3 << 8) | VERSION;
/** A regular file, readable by everyone (`0100644`), in the high half of the external attributes. */
const FILE_MODE = (0o100644 << 16) >>> 0;
/** 1980-01-01 00:00, the earliest time the format can write, so the archive does not depend on the clock. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  return crcTable;
}

/** The CRC-32 of `bytes` (the IEEE polynomial the format uses). */
export function crc32(bytes: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (lookup[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive that holds one file, `fileName`, whose content is `text` in UTF-8, stored without compression. */
export function storedZip(fileName: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const name = encoder.encode(fileName);
  const data = encoder.encode(text);
  const crc = crc32(data);

  const size = LOCAL_HEADER_SIZE + name.length + data.length + CENTRAL_HEADER_SIZE + name.length + END_RECORD_SIZE;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);

  // The local file header, its name and the file's bytes.
  view.setUint32(0, LOCAL_FILE_HEADER, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, 0, true); // flags
  view.setUint16(8, 0, true); // stored
  view.setUint16(10, 0, true); // time
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true); // extra field
  bytes.set(name, LOCAL_HEADER_SIZE);
  bytes.set(data, LOCAL_HEADER_SIZE + name.length);

  // The central directory's one entry.
  const central = LOCAL_HEADER_SIZE + name.length + data.length;
  view.setUint32(central, CENTRAL_DIRECTORY_HEADER, true);
  view.setUint16(central + 4, MADE_BY_UNIX, true);
  view.setUint16(central + 6, VERSION, true);
  view.setUint16(central + 8, 0, true); // flags
  view.setUint16(central + 10, 0, true); // stored
  view.setUint16(central + 12, 0, true); // time
  view.setUint16(central + 14, DOS_DATE, true);
  view.setUint32(central + 16, crc, true);
  view.setUint32(central + 20, data.length, true);
  view.setUint32(central + 24, data.length, true);
  view.setUint16(central + 28, name.length, true);
  view.setUint16(central + 30, 0, true); // extra field
  view.setUint16(central + 32, 0, true); // comment
  view.setUint16(central + 34, 0, true); // disk
  view.setUint16(central + 36, 0, true); // internal attributes
  view.setUint32(central + 38, FILE_MODE, true);
  view.setUint32(central + 42, 0, true); // offset of the local header
  bytes.set(name, central + CENTRAL_HEADER_SIZE);

  // The end of the central directory.
  const end = central + CENTRAL_HEADER_SIZE + name.length;
  view.setUint32(end, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(end + 4, 0, true); // this disk
  view.setUint16(end + 6, 0, true); // the directory's disk
  view.setUint16(end + 8, 1, true); // entries on this disk
  view.setUint16(end + 10, 1, true); // entries
  view.setUint32(end + 12, CENTRAL_HEADER_SIZE + name.length, true);
  view.setUint32(end + 16, central, true);
  view.setUint16(end + 20, 0, true); // comment

  return bytes;
}
