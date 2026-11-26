// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { putLogEvents } from './put-events-api';

afterEach(() => vi.unstubAllGlobals());

it('sends the exact names and ordered events and returns the rejection bounds', async () => {
  const group = '/app#group';
  const stream = 'a/b#c?d%e f';
  const events = [
    { message: '한\nline', timestamp: 123 },
    { message: 'second', timestamp: 123 },
  ];
  const bounds = { tooOldLogEventEndIndex: 1, tooNewLogEventStartIndex: 2 };
  const sent: { operation: string | undefined; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const session = new URL(request.url).pathname === '/__emuforge/session';
    if (!session) {
      sent.push({
        operation: request.headers.get('x-amz-target')?.split('.').at(-1),
        body: JSON.parse(await request.text()) as unknown,
      });
    }
    return new Response(
      JSON.stringify(session ? { token: 'emuforge-test-token' } : { rejectedLogEventsInfo: bounds }),
      {
        headers: { 'content-type': 'application/x-amz-json-1.1' },
      },
    );
  });

  await expect(
    putLogEvents('http://127.0.0.1:9968', group, stream, events, new AbortController().signal),
  ).resolves.toEqual(bounds);
  expect(sent).toEqual([
    { operation: 'PutLogEvents', body: { logGroupName: group, logStreamName: stream, logEvents: events } },
  ]);
});
