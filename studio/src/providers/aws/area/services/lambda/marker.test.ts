import { describe, expect, it } from 'vitest';

import { cutAtText, firstPageMarker } from './marker';

// The `Marker` of a filtered first page (issue 84, requirement R4.7): one case per row of its table, and its limits.

const LONG_B = `${'x'.repeat(63)}b`;

const WITH_MARKER: readonly (readonly [string, string])[] = [
  ['abc', 'abb~'],
  ['abc-', 'abc,~'],
  ['ab', 'aa~'],
  ['a', '`~'],
  ['abd', 'abc~'],
  ['a0', 'a/~'],
  ['aA', 'a@~'],
  ['a_', 'a^~'],
  ['-', ',~'],
  [LONG_B, `${'x'.repeat(63)}a~`],
];

describe('the marker of a filtered first page', () => {
  it.each([
    ['abc', 'abb~'],
    ['abc-', 'abc,~'],
    ['ab', 'aa~'],
    ['a', '`~'],
    ['abd', 'abc~'],
  ])('is %s → %s for the rows of R4.7', (text, marker) => {
    expect(firstPageMarker(text)).toBe(marker);
  });

  it.each([
    ['a0', 'a/~'],
    ['aA', 'a@~'],
    ['a_', 'a^~'],
    ['-', ',~'],
  ])('is %s → %s below a digit, an upper case letter, an underscore and a hyphen', (text, marker) => {
    expect(firstPageMarker(text)).toBe(marker);
  });

  it('keeps the first 63 characters of a text of 64 ending with b, then a, then ~', () => {
    expect(firstPageMarker(LONG_B)).toBe(`${LONG_B.slice(0, 63)}a~`);
  });

  it.each([['y'.repeat(65)], ['a b'], ['a.b'], ['a/b'], ['café'], ['함수'], ['a한']])(
    'is "matches nothing" for %s',
    (text) => {
      expect(firstPageMarker(text)).toBeUndefined();
    },
  );
});

describe('the run of names a marker starts', () => {
  const NAMES = ['Q84', '_a', 'ab-', 'abb', 'abc', 'abc-', 'abc-x', 'abd'];
  // Code point order, as the emulator sorts: every name here is ASCII, so UTF-16 order is code point order.
  const sorted = [...NAMES, LONG_B].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  it.each(WITH_MARKER)('gives, after the marker of %s, exactly the names that start with it', (text, marker) => {
    expect(firstPageMarker(text)).toBe(marker);
    const after = sorted.filter((name) => name > marker);
    const { kept } = cutAtText(
      after.map((name) => ({ name })),
      text,
    );

    expect(kept.map(({ name }) => name)).toEqual(sorted.filter((name) => name.startsWith(text)));
  });
});
