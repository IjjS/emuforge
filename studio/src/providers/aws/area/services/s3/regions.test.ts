import { describe, expect, it } from 'vitest';

import { regionText } from './regions';

describe('regionText', () => {
  it.each([
    ['ap-northeast-2', 'Asia Pacific (Seoul) ap-northeast-2'],
    ['us-east-1', 'US East (N. Virginia) us-east-1'],
  ])('writes %s with its name before the code', (code, text) => {
    expect(regionText(code)).toBe(text);
  });

  it.each(['xx-nowhere-9', 'toString', '__proto__'])('writes %s, a code without a known name, alone', (code) => {
    expect(regionText(code)).toBe(code);
  });

  it.each([undefined, ''])('writes "-" for no Region (%j)', (code) => {
    expect(regionText(code)).toBe('-');
  });
});
