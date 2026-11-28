import { expect, it } from 'vitest';

import { nameFromSegment, nameSegment, normalizeLineBreaks } from './name-segment';

it('round trips a name with path and fragment separators as one segment', () => {
  const name = '/app#name';
  expect(nameSegment(name)).toBe('%2Fapp%23name');
  expect(nameFromSegment(decodeURIComponent(nameSegment(name)))).toBe(name);
});

it.each(['.', '..'])('round trips %s without browser dot-segment normalization', (name) => {
  expect(nameSegment(name)).toBe(`*${name}`);
  expect(nameFromSegment(nameSegment(name))).toBe(name);
});

it.each(['\r', '\n', '\r\n', '\u2028', '\u2029'])(
  'round trips a name with %j and normalizes it for display',
  (breakText) => {
    const name = `one${breakText}two`;
    const encoded = `**${encodeURIComponent(encodeURIComponent(name))}`;
    expect(nameSegment(name)).toBe(encoded);
    expect(nameFromSegment(decodeURIComponent(encoded))).toBe(name);
    expect(normalizeLineBreaks(name)).toBe('one\ntwo');
  },
);
