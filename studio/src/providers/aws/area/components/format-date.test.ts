import { describe, expect, it } from 'vitest';

import { creationDateText } from './format-date';

const INSTANT = new Date('2026-10-30T14:18:34Z');

describe('creationDateText', () => {
  it('writes the instant in the zone Asia/Seoul as the console does', () => {
    expect(creationDateText(INSTANT, 'Asia/Seoul')).toBe('October 30, 2026, 23:18:34 (UTC+09:00)');
  });

  it.each([
    ['UTC', 'October 30, 2026, 14:18:34 (UTC+00:00)'],
    ['America/St_Johns', 'October 30, 2026, 11:48:34 (UTC-02:30)'],
  ])('writes the same instant in %s with that zone’s offset', (zone, text) => {
    expect(creationDateText(INSTANT, zone)).toBe(text);
  });

  it('writes the hour after midnight as 00, on a 24-hour clock', () => {
    expect(creationDateText(new Date('2026-10-30T15:05:06Z'), 'Asia/Seoul')).toBe(
      'October 31, 2026, 00:05:06 (UTC+09:00)',
    );
  });

  it.each([undefined, new Date('not a date')])('writes "-" for no date (%s)', (date) => {
    expect(creationDateText(date, 'UTC')).toBe('-');
  });
});
