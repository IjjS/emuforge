import { expect, it } from 'vitest';

import { alarmNameFromSearch, alarmPath, editAlarmPath } from './paths';

it.each([
  '/./../?#%&+',
  '\n\r\u2028\u2029\u0085\t\u0000',
  ' leading  and trailing ',
  '😀',
  '*prefix',
  '.',
  '..',
  '   ',
  'a'.repeat(255),
])('writes %j only in the query and reads it back unchanged', (name) => {
  for (const [written, expectedPath] of [
    [alarmPath(name), '/aws/cloudwatch/alarms/alarm'],
    [editAlarmPath(name), '/aws/cloudwatch/alarms/edit'],
  ] as const) {
    const address = new URL(written, 'http://127.0.0.1');
    expect(address.pathname).toBe(expectedPath);
    expect([...address.searchParams.entries()]).toEqual([['name', name]]);
    expect(alarmNameFromSearch(address.search)).toBe(name);
  }
});

it.each(['', '?other=hi', '?name='])('returns no name for %j', (search) => {
  expect(alarmNameFromSearch(search)).toBeUndefined();
});
