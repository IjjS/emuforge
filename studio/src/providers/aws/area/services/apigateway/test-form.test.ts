import { expect, it } from 'vitest';

import { parseTestHeaders } from './test-form';

it('parses header lines, ignores blank lines and keeps colons inside a value', () => {
  expect(parseTestHeaders('Accept: application/json\r\n\r\n  \nX-Time: 12:30\n')).toEqual({
    headers: { Accept: 'application/json', 'X-Time': '12:30' },
  });
  expect(parseTestHeaders(' \n')).toEqual({ headers: {} });
});

it('reports a line without a colon', () => {
  expect(parseTestHeaders('Accept: application/json\nX-Time')).toEqual({ error: 'Write each header as Name: value.' });
});
