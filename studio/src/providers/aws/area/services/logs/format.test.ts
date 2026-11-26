import { describe, expect, it } from 'vitest';

import {
  deletionProtectionText,
  logGroupClassText,
  logGroupPath,
  logStreamPath,
  nameFromSegment,
  nameSegment,
  RETENTION_DAYS,
  retentionText,
} from './format';

describe('log names in addresses', () => {
  it('writes a group name with slashes and a hash as one reversible segment', () => {
    const name = '/aws/lambda/fn#first';
    expect(nameSegment('/aws/lambda/fn')).toBe('%2Faws%2Flambda%2Ffn');
    expect(logGroupPath(name)).toBe('/aws/logs/log-groups/group/%2Faws%2Flambda%2Ffn%23first');
    expect(nameFromSegment(decodeURIComponent(nameSegment(name)))).toBe(name);
  });

  it('keeps dot names and reserved stream characters through a URL and one decode', () => {
    expect(nameSegment('.')).toBe('*.');
    expect(nameSegment('..')).toBe('*..');
    for (const stream of ['.', '..', 'a/b#c?d%e f']) {
      const address = new URL(logStreamPath('..', stream), 'http://127.0.0.1');
      expect(address.pathname.split('/').length).toBe(8);
      const segment = address.pathname.split('/').at(-1) ?? '';
      expect(nameFromSegment(decodeURIComponent(segment))).toBe(stream);
    }
  });
});

describe('log group values', () => {
  it('writes absence, singular and plural retention, each class and both protection states', () => {
    expect(retentionText(undefined)).toBe('Never expire');
    expect(retentionText(1)).toBe('1 day');
    expect(retentionText(30)).toBe('30 days');
    expect(logGroupClassText('STANDARD')).toBe('Standard');
    expect(logGroupClassText('INFREQUENT_ACCESS')).toBe('Infrequent Access');
    expect(logGroupClassText('DELIVERY')).toBe('Delivery');
    expect(deletionProtectionText(true)).toBe('On');
    expect(deletionProtectionText(false)).toBe('Off');
  });

  it('offers the 22 retention periods the emulator accepts, in ascending order', () => {
    expect(RETENTION_DAYS).toEqual([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653,
    ]);
  });
});
