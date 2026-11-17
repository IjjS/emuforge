import { describe, expect, it } from 'vitest';

import { storedZip } from './zip';

// The archive "Create Event Function" sends (issue 84, requirement R6.5), read back field by field.

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The fields of the archive's one entry, from its local header, its central entry and its end record. */
function read(bytes: Uint8Array) {
  const v = view(bytes);
  const nameLength = v.getUint16(26, true);
  const extraLength = v.getUint16(28, true);
  const size = v.getUint32(22, true);
  const dataStart = 30 + nameLength + extraLength;
  const end = bytes.length - 22;
  const central = v.getUint32(end + 16, true);
  return {
    localSignature: v.getUint32(0, true),
    method: v.getUint16(8, true),
    crc: v.getUint32(14, true),
    compressedSize: v.getUint32(18, true),
    size,
    name: new TextDecoder().decode(bytes.subarray(30, 30 + nameLength)),
    data: bytes.subarray(dataStart, dataStart + size),
    centralSignature: v.getUint32(central, true),
    centralMethod: v.getUint16(central + 10, true),
    centralCrc: v.getUint32(central + 16, true),
    centralCompressedSize: v.getUint32(central + 20, true),
    centralSize: v.getUint32(central + 24, true),
    centralName: new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + v.getUint16(central + 28, true))),
    endSignature: v.getUint32(end, true),
    entriesOnDisk: v.getUint16(end + 8, true),
    entries: v.getUint16(end + 10, true),
  };
}

describe('the archive of one file', () => {
  it('starts with a local file header, holds the name and the text unchanged, stored, and ends with one entry', () => {
    const text = 'export const handler = async () => ({ statusCode: 200 });\n';
    const bytes = storedZip('index.mjs', text);
    const entry = read(bytes);

    expect(entry.localSignature).toBe(LOCAL_FILE_HEADER);
    expect(entry.name).toBe('index.mjs');
    expect(entry.method).toBe(0);
    expect(entry.centralMethod).toBe(0);
    expect(new TextDecoder().decode(entry.data)).toBe(text);
    expect(entry.compressedSize).toBe(entry.size);
    expect(entry.centralSignature).toBe(CENTRAL_DIRECTORY_HEADER);
    expect(entry.centralName).toBe('index.mjs');
    expect(entry.endSignature).toBe(END_OF_CENTRAL_DIRECTORY);
    expect(entry.entriesOnDisk).toBe(1);
    expect(entry.entries).toBe(1);
  });

  it('writes the CRC-32 0xCBF43926 for the text 123456789, in both headers', () => {
    const entry = read(storedZip('check.txt', '123456789'));

    expect(entry.crc).toBe(0xcbf43926);
    expect(entry.centralCrc).toBe(0xcbf43926);
  });

  it('gives the text’s length in UTF-8 bytes as every size of both headers, for characters outside ASCII', () => {
    const text = 'é 한 ✓ 🙂';
    const utf8 = new TextEncoder().encode(text).length;
    expect(utf8).toBeGreaterThan(text.length);

    const entry = read(storedZip('lambda_function.py', text));

    expect(entry.size).toBe(utf8);
    expect(entry.compressedSize).toBe(utf8);
    expect(entry.centralSize).toBe(utf8);
    expect(entry.centralCompressedSize).toBe(utf8);
    expect(new TextDecoder().decode(entry.data)).toBe(text);
  });
});
