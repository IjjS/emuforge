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

it('fills in filtered groups by name, keeping the pattern order, missing rows and page token', async () => {
  const logs = { logGroupName: '/app#Cold', retentionInDays: 7, deletionProtectionEnabled: true };
  const protectedLogs = { logGroupName: '/protected#Cold', retentionInDays: 30, deletionProtectionEnabled: true };
  const missing = { logGroupName: '/missing#Cold', creationTime: 1000 };
  answer
    .mockResolvedValueOnce(
      response({
        logGroups: [{ logGroupName: logs.logGroupName }, missing, { logGroupName: protectedLogs.logGroupName }],
        nextToken: 'after',
      }),
    )
    .mockResolvedValueOnce(response({ logGroups: [protectedLogs, logs] }));
  await expect(listLogGroups(endpoint, 'Cold', 'before', signal())).resolves.toEqual({
    items: [logs, missing, protectedLogs],
    next: 'after',
  });
  expect(sent).toEqual([
    { operation: 'DescribeLogGroups', body: { logGroupNamePattern: 'Cold', limit: 25, nextToken: 'before' } },
    {
      operation: 'DescribeLogGroups',
      body: { logGroupIdentifiers: [logs.logGroupName, missing.logGroupName, protectedLogs.logGroupName] },
    },
  ]);
});

it('reports a failed identifier read as a DescribeLogGroups listing failure', async () => {
  answer.mockResolvedValueOnce(response({ logGroups: [{ logGroupName: 'match' }] })).mockResolvedValueOnce(
    new Response(JSON.stringify({ __type: 'AccessDeniedException', message: 'denied' }), {
      status: 403,
      headers: { 'content-type': 'application/x-amz-json-1.1' },
    }),
  );

  await expect(listLogGroups(endpoint, 'match', undefined, signal())).rejects.toMatchObject({
    name: 'RequestError',
    failure: { kind: 'access-denied', operation: 'DescribeLogGroups', message: 'denied' },
  });
  expect(sent).toEqual([
    { operation: 'DescribeLogGroups', body: { limit: 25, logGroupNamePattern: 'match' } },
    { operation: 'DescribeLogGroups', body: { logGroupIdentifiers: ['match'] } },
  ]);
});

it.each([
  { pattern: '', namesOnly: false, logGroups: [{ logGroupName: 'match', retentionInDays: 7 }] },
  { pattern: 'match', namesOnly: true, logGroups: [{ logGroupName: 'match' }] },
  { pattern: 'match', namesOnly: false, logGroups: [] },
])(
  'reads a page once with pattern "$pattern", namesOnly=$namesOnly and rows $logGroups',
  async ({ pattern, namesOnly, logGroups }) => {
    answer.mockResolvedValueOnce(response({ logGroups }));
    await expect(listLogGroups(endpoint, pattern, undefined, signal(), { namesOnly })).resolves.toEqual({
      items: logGroups,
    });
    expect(sent).toEqual([
      {
        operation: 'DescribeLogGroups',
        body: { limit: 25, ...(pattern === '' ? {} : { logGroupNamePattern: pattern }) },
      },
    ]);
  },
);

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
  const started = deferred<undefined>();
  answer.mockImplementationOnce(() => {
    started.resolve(undefined);
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
