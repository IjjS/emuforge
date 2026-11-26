// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getLogEvents, type EventRead } from './event-api';

const group = '/app#group';
const stream = 'a/b#c?d%e f';
const events = [{ timestamp: 123, message: 'example' }];
const sent: { operation: string | undefined; body: unknown }[] = [];
let nextPort = 9950;
let endpoint: string;

function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  endpoint = `http://127.0.0.1:${String(nextPort++)}`;
  sent.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return response({ token: 'emuforge-test-token' });
    }
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: JSON.parse(await request.text()) as unknown,
    });
    return response({ events, nextBackwardToken: 'older', nextForwardToken: 'newer' });
  });
});

afterEach(() => vi.unstubAllGlobals());

it.each<{ read: EventRead; fields: Record<string, unknown> }>([
  { read: { kind: 'newest' }, fields: {} },
  { read: { kind: 'continue', token: 'other/page' }, fields: { nextToken: 'other/page' } },
  { read: { kind: 'from-time', time: 123 }, fields: { startTime: 123, startFromHead: true } },
  { read: { kind: 'before-time', time: 123 }, fields: { endTime: 123 } },
])('sends GetLogEvents with limit 100 for a $read.kind read', async ({ read, fields }) => {
  await expect(getLogEvents(endpoint, group, stream, read, new AbortController().signal)).resolves.toEqual({
    events,
    nextBackwardToken: 'older',
    nextForwardToken: 'newer',
  });
  expect(sent).toEqual([
    { operation: 'GetLogEvents', body: { logGroupName: group, logStreamName: stream, limit: 100, ...fields } },
  ]);
});
