// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getLogGroup, listLogGroups, listLogGroupTags } from './api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface Sent {
  operation: string | null;
  body: unknown;
}

const sent: Sent[] = [];
let endpoint: string;
let nextPort = 9940;

const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/x-amz-json-1.1' } });

const answer = vi.fn<() => Promise<Response>>();

beforeEach(() => {
  endpoint = `http://127.0.0.1:${String(nextPort++)}`;
  sent.length = 0;
  answer.mockReset();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return response({ token: 'emuforge-test-token' });
    }
    const target = request.headers.get('x-amz-target');
    sent.push({
      operation: target?.split('.').at(-1) ?? null,
      body: JSON.parse(await request.text()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;

it('reads a page with the pattern, limit and token, returning the groups and the answer token', async () => {
  const logGroups = [{ logGroupName: '/app#Cold', retentionInDays: 7, deletionProtectionEnabled: true }];
  answer.mockResolvedValueOnce(response({ logGroups, nextToken: 'after' }));
  await expect(listLogGroups(endpoint, 'Cold', 'before', signal())).resolves.toEqual({
    items: logGroups,
    next: 'after',
  });
  expect(sent).toEqual([
    { operation: 'DescribeLogGroups', body: { logGroupNamePattern: 'Cold', limit: 25, nextToken: 'before' } },
  ]);
});

it.each([{ logGroups: [{ logGroupName: 'match' }], nextToken: 'after' }, { logGroups: [] }])(
  'reads on past an empty answer with a token, then returns %j',
  async (last) => {
    answer.mockResolvedValueOnce(response({ nextToken: 'skip' })).mockResolvedValueOnce(response(last));
    await expect(listLogGroups(endpoint, '', undefined, signal())).resolves.toEqual({
      items: last.logGroups,
      ...('nextToken' in last ? { next: last.nextToken } : {}),
    });
    expect(sent).toEqual([
      { operation: 'DescribeLogGroups', body: { limit: 25 } },
      { operation: 'DescribeLogGroups', body: { limit: 25, nextToken: 'skip' } },
    ]);
  },
);

it('reads a single group by its identifier and distinguishes an empty answer from failure', async () => {
  const group = { logGroupName: 'one#group' };
  answer.mockResolvedValueOnce(response({ logGroups: [group] })).mockResolvedValueOnce(response({ logGroups: [] }));
  await expect(getLogGroup(endpoint, group.logGroupName, signal())).resolves.toEqual({ kind: 'found', group });
  await expect(getLogGroup(endpoint, 'missing', signal())).resolves.toEqual({ kind: 'not-found' });
  expect(sent).toEqual([
    { operation: 'DescribeLogGroups', body: { logGroupIdentifiers: ['one#group'] } },
    { operation: 'DescribeLogGroups', body: { logGroupIdentifiers: ['missing'] } },
  ]);
});

it('reads tags by the literal group name, including its hash', async () => {
  answer.mockResolvedValueOnce(response({ tags: { app: 'web' } }));
  await expect(listLogGroupTags(endpoint, '/app#Cold', signal())).resolves.toEqual({ app: 'web' });
  expect(sent).toEqual([{ operation: 'ListTagsLogGroup', body: { logGroupName: '/app#Cold' } }]);
});

it('rejects immediately when a read aborts, before its response settles', async () => {
  const pending = deferred<Response>();
  const started = deferred<void>();
  answer.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  const stop = new AbortController();
  const read = listLogGroups(endpoint, '', undefined, stop.signal);
  await started.promise;
  stop.abort();
  await expect(read).rejects.toBe(stop.signal.reason);
  pending.resolve(response({ nextToken: 'late' }));
  expect(sent).toHaveLength(1);
});
