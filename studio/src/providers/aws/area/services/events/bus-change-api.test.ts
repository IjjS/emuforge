// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createEventBus, deleteEventBus } from './bus-change-api';
import { createBusInput } from './bus-form';

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

it('sends the built create request and deletes by name', async () => {
  const input = createBusInput({ name: 'orders', description: 'Order events', tags: [{ key: 'team', value: 'core' }] });
  answer.mockResolvedValueOnce(response({ EventBusArn: 'arn:orders' })).mockResolvedValueOnce(response({}));
  await createEventBus(endpoint, input, signal());
  await deleteEventBus(endpoint, 'orders', signal());
  expect(sent).toStrictEqual([
    { operation: 'CreateEventBus', body: input },
    { operation: 'DeleteEventBus', body: { Name: 'orders' } },
  ]);
});

it.each([
  ['CreateEventBus', () => createEventBus(endpoint, { Name: 'orders' }, signal())],
  ['DeleteEventBus', () => deleteEventBus(endpoint, 'orders', signal())],
] as const)('keeps the named refusal of %s', async (operation, send) => {
  answer.mockResolvedValueOnce(response({ __type: 'ValidationException', message: 'Bus refused' }, 400));
  await expect(send()).rejects.toMatchObject({
    failure: { operation, kind: 'other', code: 'ValidationException', message: 'Bus refused' },
  });
});
