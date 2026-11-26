// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { listLogStreams } from './stream-api';

const sent: unknown[] = [];
const answer = vi.fn<() => Response>();
let endpoint: string;
let port = 9948;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  endpoint = `http://127.0.0.1:${String(port++)}`;
  answer.mockReset();
  sent.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return json({ token: 'emuforge-test-token' });
    }
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: JSON.parse(await request.text()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['', { orderBy: 'LastEventTime', descending: true }],
  ['prefix', { logStreamNamePrefix: 'prefix' }],
])('reads a token page of streams with prefix %j', async (prefix, fields) => {
  const logStreams = [{ logStreamName: 'prefix/a', lastEventTimestamp: 42 }];
  answer.mockReturnValueOnce(json({ logStreams, nextToken: 'after' }));
  await expect(listLogStreams(endpoint, 'group#one', prefix, 'before', new AbortController().signal)).resolves.toEqual({
    items: logStreams,
    next: 'after',
  });
  expect(sent).toEqual([
    { operation: 'DescribeLogStreams', body: { logGroupName: 'group#one', limit: 25, nextToken: 'before', ...fields } },
  ]);
});

it('preserves the missing group refusal from DescribeLogStreams', async () => {
  answer.mockReturnValueOnce(
    json({ __type: 'ResourceNotFoundException', message: 'The specified log group does not exist.' }, 400),
  );
  await expect(listLogStreams(endpoint, 'missing', '', undefined, new AbortController().signal)).rejects.toMatchObject({
    failure: {
      kind: 'other',
      operation: 'DescribeLogStreams',
      code: 'ResourceNotFoundException',
      message: 'The specified log group does not exist.',
    },
  });
});
