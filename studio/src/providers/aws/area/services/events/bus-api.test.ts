// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getEventBus, listEventBuses, listResourceTags } from './bus-api';

let endpoint: string;
let nextPort = 9940;
const sent: { operation: string | undefined; body: unknown }[] = [];
const answer = vi.fn<() => Promise<Response>>();
const signal = () => new AbortController().signal;

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  endpoint = `http://127.0.0.1:${String(nextPort++)}`;
  sent.length = 0;
  answer.mockReset();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return response({ token: 'emuforge-test-token' });
    }
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

it('reads one page with its token and adds a prefix only when provided', async () => {
  const wire = {
    Name: 'orders',
    Arn: 'arn:orders',
    Description: 'Orders',
    CreationTime: 1700000000,
    LastModifiedTime: 1700000001,
  };
  const defaultBus = { Name: 'default', Arn: 'arn:default' };
  answer
    .mockResolvedValueOnce(response({ EventBuses: [wire], NextToken: 'after' }))
    .mockResolvedValueOnce(response({ EventBuses: [defaultBus] }));
  await expect(listEventBuses(endpoint, 'Orders', 'before', signal())).resolves.toEqual({
    items: [{ ...wire, CreationTime: new Date(1700000000000), LastModifiedTime: new Date(1700000001000) }],
    next: 'after',
  });
  await expect(listEventBuses(endpoint, '', undefined, signal())).resolves.toStrictEqual({ items: [defaultBus] });
  expect(sent).toEqual([
    { operation: 'ListEventBuses', body: { Limit: 25, NextToken: 'before', NamePrefix: 'Orders' } },
    { operation: 'ListEventBuses', body: { Limit: 25 } },
  ]);
});

it('reads a named bus with the optional members only when given', async () => {
  const basic = { Name: 'orders', Arn: 'arn:orders', Description: 'Orders' };
  const extended = {
    ...basic,
    Policy: '{}',
    KmsKeyIdentifier: 'alias/bus',
    DeadLetterConfig: { Arn: 'arn:queue' },
    LogConfig: { Level: 'INFO' },
  };
  answer.mockResolvedValueOnce(response(extended)).mockResolvedValueOnce(response(basic));
  await expect(getEventBus(endpoint, 'orders', signal())).resolves.toStrictEqual({ kind: 'found', bus: extended });
  await expect(getEventBus(endpoint, 'orders', signal())).resolves.toStrictEqual({ kind: 'found', bus: basic });
  expect(sent).toEqual([
    { operation: 'DescribeEventBus', body: { Name: 'orders' } },
    { operation: 'DescribeEventBus', body: { Name: 'orders' } },
  ]);
});

it('recognizes the emulator’s missing bus response', async () => {
  const message = 'Event bus orders does not exist.';
  answer.mockResolvedValueOnce(response({ __type: 'ResourceNotFoundException', message }, 400));
  await expect(getEventBus(endpoint, 'orders', signal())).resolves.toEqual({ kind: 'not-found', message });
});

it('indexes tags by key and keeps an empty value', async () => {
  answer.mockResolvedValueOnce(
    response({
      Tags: [
        { Key: 'env', Value: 'local' },
        { Key: 'owner', Value: '' },
      ],
    }),
  );
  await expect(listResourceTags(endpoint, 'arn:orders', signal())).resolves.toEqual({ env: 'local', owner: '' });
  expect(sent).toEqual([{ operation: 'ListTagsForResource', body: { ResourceARN: 'arn:orders' } }]);
});

const reads = [
  ['ListEventBuses', (signal: AbortSignal) => listEventBuses(endpoint, '', undefined, signal)],
  ['DescribeEventBus', (signal: AbortSignal) => getEventBus(endpoint, 'orders', signal)],
  ['ListTagsForResource', (signal: AbortSignal) => listResourceTags(endpoint, 'arn:orders', signal)],
] as const;

it.each(reads)('keeps the name of a refused %s read', async (operation, read) => {
  answer.mockResolvedValueOnce(response({ __type: 'AccessDeniedException', message: 'Denied' }, 403));
  await expect(read(signal())).rejects.toMatchObject({
    failure: { operation, kind: 'access-denied', message: 'Denied' },
  });
});

it.each(reads)('aborts %s while the response is pending', async (_operation, read) => {
  answer.mockImplementationOnce(() => new Promise<never>(() => undefined));
  const controller = new AbortController();
  const pending = read(controller.signal);
  const outcome = expect(pending).rejects.toBe('left page');
  await vi.waitFor(() => expect(answer).toHaveBeenCalledOnce());
  controller.abort('left page');
  await outcome;
});
