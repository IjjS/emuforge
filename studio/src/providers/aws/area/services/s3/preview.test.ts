import { describe, expect, it, vi } from 'vitest';

import { isPreviewable, loadPreview, PREVIEW_BYTES, PREVIEW_RANGE, previewText } from './preview';

// The preview of an object's body (test-criteria.md, issue 480, "Unit s2 — services/s3/preview.test.ts").

const encoder = new TextEncoder();

describe('isPreviewable: the types shown as text', () => {
  const listed = [
    'text/plain',
    'text/csv',
    'text/html',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
    'application/javascript',
    'application/x-ndjson',
    'application/ld+json',
    'application/vnd.api+json',
    'image/svg+xml',
    'application/atom+xml',
  ];

  it.each(listed)('%s, alone, with a charset and in any case → previewed', (type) => {
    expect(isPreviewable(type)).toBe(true);
    expect(isPreviewable(`${type}; charset=utf-8`)).toBe(true);
    expect(isPreviewable(`${type};charset=ISO-8859-1`)).toBe(true);
    expect(isPreviewable(type.toUpperCase())).toBe(true);
    expect(isPreviewable(`${type.replace(/^./, (c) => c.toUpperCase())}; Charset="UTF-8"`)).toBe(true);
  });

  it.each(['image/png', 'application/octet-stream', 'binary/octet-stream', 'application/pdf', 'video/mp4', ''])(
    '%s → not previewed',
    (type) => {
      expect(isPreviewable(type)).toBe(false);
    },
  );

  it('an absent type → not previewed', () => {
    expect(isPreviewable(undefined)).toBe(false);
  });
});

describe('previewText: the bytes read as text', () => {
  it('bytes that are not UTF-8 → U+FFFD in their place', () => {
    const bytes = new Uint8Array([0x61, 0xff, 0x62, 0xc3, 0x28]);
    const preview = previewText(bytes, bytes.length);
    expect(preview).toEqual({ kind: 'text', text: 'a�b�(', truncated: false, size: 5 });
  });

  it('a character cut at 65536 bytes → left out, and the body said to be longer', () => {
    // 65535 bytes of "a", then the first byte of "한" (three bytes): the read ends inside the character.
    const whole = new Uint8Array([...encoder.encode('a'.repeat(PREVIEW_BYTES - 1)), ...encoder.encode('한')]);
    const read = whole.subarray(0, PREVIEW_BYTES);
    const preview = previewText(read, whole.length);
    expect(preview.kind).toBe('text');
    if (preview.kind !== 'text') return;
    expect(preview.text).toBe('a'.repeat(PREVIEW_BYTES - 1));
    expect(preview.text.includes('�')).toBe(false);
    expect(preview.truncated).toBe(true);
    expect(preview.size).toBe(whole.length);
  });

  it('a whole body that ends inside a character → U+FFFD, since nothing was cut', () => {
    const bytes = new Uint8Array([0x61, 0xed, 0x95]);
    expect(previewText(bytes, 3)).toEqual({ kind: 'text', text: 'a�', truncated: false, size: 3 });
  });

  it('an empty object → empty ("This object is empty.")', () => {
    expect(previewText(new Uint8Array(), 0)).toEqual({ kind: 'empty' });
  });

  it('a body longer than 65536 bytes → truncated (the "Showing the first 64 KiB of" line); one of 65536 → not', () => {
    const bytes = encoder.encode('x'.repeat(PREVIEW_BYTES));
    expect(previewText(bytes, 204_800)).toMatchObject({ kind: 'text', truncated: true, size: 204_800 });
    expect(previewText(bytes, PREVIEW_BYTES)).toMatchObject({ kind: 'text', truncated: false });
  });
});

describe('loadPreview: what is asked', () => {
  it('a type shown as text and a size above 0 → `Range: bytes=0-65535`, once', async () => {
    const readRange = vi.fn((range: string) => {
      void range;
      return Promise.resolve(encoder.encode('{"a":1}'));
    });
    const preview = await loadPreview({ contentType: 'application/json', size: 7 }, readRange);
    expect(PREVIEW_RANGE).toBe('bytes=0-65535');
    expect(readRange.mock.calls).toEqual([['bytes=0-65535']]);
    expect(preview).toEqual({ kind: 'text', text: '{"a":1}', truncated: false, size: 7 });
  });

  it('a type not previewed → nothing asked, "No preview for this type"', async () => {
    const readRange = vi.fn(() => Promise.resolve(new Uint8Array()));
    await expect(loadPreview({ contentType: 'image/png', size: 2048 }, readRange)).resolves.toEqual({
      kind: 'not-previewed',
    });
    await expect(loadPreview({ size: 10 }, readRange)).resolves.toEqual({ kind: 'not-previewed' });
    expect(readRange).not.toHaveBeenCalled();
  });

  it('a size of 0 → nothing asked, empty', async () => {
    const readRange = vi.fn(() => Promise.resolve(new Uint8Array()));
    await expect(loadPreview({ contentType: 'text/plain', size: 0 }, readRange)).resolves.toEqual({ kind: 'empty' });
    expect(readRange).not.toHaveBeenCalled();
  });

  it('a read failure rejects as it came', async () => {
    const failure = new Error('read failed');
    await expect(loadPreview({ contentType: 'text/plain', size: 4 }, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });
});
