import { expect, it } from 'vitest';

import { EMPTY_MESSAGE_ERROR, eventsAt, putEventCounts, validateMessages } from './put-events';

it('charges UTF-8 bytes and 26 bytes per message at the batch limit', () => {
  const ascii = 'x'.repeat(1_048_521);
  expect(validateMessages([ascii, '한'])).toEqual({ messageErrors: [undefined, undefined], batchError: undefined });
  expect(validateMessages([ascii + 'x', '한']).batchError).toBe('The batch is larger than 1,048,576 bytes.');
});

it('rejects an empty message and keeps message order, whitespace and the shared timestamp', () => {
  expect(validateMessages(['one', '', 'two']).messageErrors).toEqual([undefined, EMPTY_MESSAGE_ERROR, undefined]);
  expect(eventsAt(['one', 'two\nlines', ' three '], 123)).toEqual([
    { message: 'one', timestamp: 123 },
    { message: 'two\nlines', timestamp: 123 },
    { message: ' three ', timestamp: 123 },
  ]);
});

it.each([
  { sent: 3, bounds: { tooOldLogEventEndIndex: 1, tooNewLogEventStartIndex: 2 }, stored: 1, rejected: 2 },
  { sent: 3, bounds: { tooOldLogEventEndIndex: 1 }, stored: 2, rejected: 1 },
  { sent: 3, bounds: { expiredLogEventEndIndex: 2, tooOldLogEventEndIndex: 1 }, stored: 1, rejected: 2 },
  { sent: 3, bounds: undefined, stored: 3, rejected: 0 },
  { sent: 1, bounds: { tooOldLogEventEndIndex: 1 }, stored: 0, rejected: 1 },
])('counts $stored stored and $rejected rejected out of $sent from $bounds', ({ sent, bounds, stored, rejected }) => {
  expect(putEventCounts(sent, bounds)).toEqual({ stored, rejected });
});
