import { describe, expect, it } from 'vitest';

import { holdsEndRecord, isZipArchive, storedZip, ZIP_TAIL_SIZE } from './zip';

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

// The zip check of an upload and of "Upload a .zip file" (issue 516, test criteria "Unit s1 — zip.test.ts").

/** `archive` with an archive comment of `length` bytes: the end record names it, and it ends the file. */
function withComment(archive: Uint8Array, length: number): Uint8Array {
  const bytes = new Uint8Array(archive.length + length);
  bytes.set(archive);
  bytes.fill(0x41, archive.length);
  view(bytes).setUint16(archive.length - 2, length, true);
  return bytes;
}

const STARTER = storedZip('index.mjs', 'export const handler = async () => 1;\n');

function file(bytes: Uint8Array, name = 'code.zip'): File {
  return new File([bytes], name);
}

describe('the zip check', () => {
  it.each([
    ['the starter archive Studio writes', STARTER],
    ['an archive ending with a comment', withComment(STARTER, 12)],
    ['an archive whose comment is 65,535 bytes', withComment(STARTER, 65_535)],
  ])('takes %s as a .zip archive', async (_, bytes) => {
    expect(holdsEndRecord(bytes)).toBe(true);
    expect(await isZipArchive(file(bytes))).toBe(true);
  });

  it.each([
    ['empty bytes', new Uint8Array(0)],
    ['plain text', new TextEncoder().encode('These are my notes, not an archive.\n'.repeat(20))],
    [
      'bytes holding PK\\x05\\x06 at a place whose comment length runs past the end',
      (() => {
        const bytes = new Uint8Array(40);
        const v = view(bytes);
        v.setUint32(10, END_OF_CENTRAL_DIRECTORY, true);
        v.setUint16(30, 9, true);
        return bytes;
      })(),
    ],
    ['an archive cut before its end record', STARTER.slice(0, STARTER.length - 22)],
    ['an archive cut inside its end record', STARTER.slice(0, STARTER.length - 4)],
    ['an archive whose comment was cut short', withComment(STARTER, 100).slice(0, STARTER.length + 50)],
  ])('takes %s as no archive', async (_, bytes) => {
    expect(holdsEndRecord(bytes)).toBe(false);
    expect(await isZipArchive(file(bytes))).toBe(false);
  });

  it('reads only the last 65,557 bytes of a file of 1 MB whose end record is in its last bytes', async () => {
    const size = 1024 * 1024;
    const bytes = new Uint8Array(size);
    bytes.set(STARTER, size - STARTER.length);
    const chosen = file(bytes);
    const sliced: [number | undefined, number | undefined][] = [];
    const read: number[] = [];
    const slice = chosen.slice.bind(chosen);
    chosen.slice = (start?: number, end?: number, contentType?: string) => {
      sliced.push([start, end]);
      const part = slice(start, end, contentType);
      const arrayBuffer = part.arrayBuffer.bind(part);
      part.arrayBuffer = () => {
        read.push(part.size);
        return arrayBuffer();
      };
      return part;
    };
    chosen.arrayBuffer = () => {
      throw new Error('the whole file was read');
    };

    expect(ZIP_TAIL_SIZE).toBe(65_557);
    expect(await isZipArchive(chosen)).toBe(true);
    expect(sliced).toEqual([[size - 65_557, size]]);
    expect(read).toEqual([65_557]);
  });
});
