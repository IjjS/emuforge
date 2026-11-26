// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { filterLogEvents } from './search-api';
import type { SearchRequest } from './search-form';

afterEach(() => vi.unstubAllGlobals());

it('sends FilterLogEvents with the request, limit and token and returns the events and next token', async () => {
  const events = [{ eventId: 'e1', logStreamName: 'web', timestamp: 123, message: 'error one' }];
  const sent: { operation: string | null; input: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const session = new URL(request.url).pathname === '/__emuforge/session';
    if (!session) {
      sent.push({
        operation: request.headers.get('x-amz-target'),
        input: JSON.parse(await request.text()) as unknown,
      });
    }
    return new Response(JSON.stringify(session ? { token: 'emuforge-test-token' } : { events, nextToken: 'next' }), {
      headers: { 'content-type': 'application/x-amz-json-1.1' },
    });
  });
  const request: SearchRequest = {
    logGroupName: '/example',
    logStreamNames: ['web'],
    startTime: 100,
    endTime: 200,
    filterPattern: 'error',
  };

  await expect(
    filterLogEvents('http://127.0.0.1:9950', request, 'page-2', new AbortController().signal),
  ).resolves.toEqual({
    items: events,
    next: 'next',
  });
  expect(sent).toEqual([
    { operation: 'Logs_20140328.FilterLogEvents', input: { ...request, limit: 100, nextToken: 'page-2' } },
  ]);
});
