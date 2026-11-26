// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { createLogStream, deleteLogStream } from './stream-change-api';

afterEach(() => vi.unstubAllGlobals());

it('sends the group and stream names unchanged in each operation', async () => {
  const endpoint = 'http://127.0.0.1:9949';
  const group = '/app#Group';
  const name = 'a b/[$LATEST]#?%';
  const signal = new AbortController().signal;
  const sent: { target: string | null; body: unknown }[] = [];
  const headers = { 'content-type': 'application/x-amz-json-1.1' };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token' }), { headers });
    }
    sent.push({
      target: request.headers.get('x-amz-target'),
      body: JSON.parse(await request.text()) as unknown,
    });
    return new Response('{}', { headers });
  });

  await createLogStream(endpoint, group, name, signal);
  await deleteLogStream(endpoint, group, name, signal);

  const body = { logGroupName: group, logStreamName: name };
  expect(sent).toEqual([
    { target: 'Logs_20140328.CreateLogStream', body },
    { target: 'Logs_20140328.DeleteLogStream', body },
  ]);
});
