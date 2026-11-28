// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { putEvent } from './send-api';

const entry = {
  EventBusName: 'orders',
  Source: 'shop',
  DetailType: 'order placed',
  Detail: '{}',
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

afterEach(() => vi.unstubAllGlobals());

it('sends one PutEvents entry and distinguishes acceptance, entry failure and request refusal', async () => {
  const sent = vi
    .fn<(target: string | null, body: unknown) => Response>()
    .mockReturnValueOnce(response({ FailedEntryCount: 0, Entries: [{ EventId: 'event-1' }] }))
    .mockReturnValueOnce(
      response({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'MalformedDetail', ErrorMessage: 'Detail is malformed.' }],
      }),
    )
    .mockReturnValueOnce(response({ __type: 'ValidationException', message: 'Request refused' }, 400));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return response({ token: 'emuforge-test-token' });
    }
    return sent(request.headers.get('x-amz-target'), (await request.json()) as unknown);
  });
  const endpoint = 'http://127.0.0.1:9969';
  const send = () => putEvent(endpoint, entry, new AbortController().signal);
  await expect(send()).resolves.toEqual({ kind: 'accepted', id: 'event-1' });
  await expect(send()).resolves.toEqual({ kind: 'refused', code: 'MalformedDetail', message: 'Detail is malformed.' });
  await expect(send()).rejects.toMatchObject({
    failure: { operation: 'PutEvents', code: 'ValidationException', message: 'Request refused' },
  });
  expect(sent.mock.calls).toEqual(Array.from({ length: 3 }, () => ['AWSEvents.PutEvents', { Entries: [entry] }]));
});
