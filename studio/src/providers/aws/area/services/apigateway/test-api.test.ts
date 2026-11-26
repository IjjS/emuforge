import { afterEach, expect, it, vi } from 'vitest';

import { testInvokeMethod } from './test-api';

afterEach(() => vi.unstubAllGlobals());

it('sends TestInvokeMethod using the registered key and gives back the emulator answer', async () => {
  const answer = {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
    body: 'Failure',
    log: 'Execution log\nFailure',
    latency: 0,
  };
  const sent = vi.fn<(request: Request) => Response>().mockImplementation(() => Response.json(answer));
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Promise.resolve(Response.json({ token: 'test-session' }));
    }
    return Promise.resolve(sent(request));
  });
  const endpoint = 'http://127.0.0.1:9682';
  const payload = { pathWithQueryString: '/orders?limit=1', headers: { Accept: 'text/plain' }, body: 'request' };

  await expect(
    testInvokeMethod(
      endpoint,
      { restApiId: 'api-1', resourceId: 'orders', httpMethod: 'ANY', ...payload },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject(answer);

  expect(sent).toHaveBeenCalledTimes(1);
  const request = sent.mock.calls[0]?.[0];
  if (!request) throw new Error('No request was sent');
  expect(request.method).toBe('POST');
  expect(request.url).toBe(`${endpoint}/restapis/api-1/resources/orders/methods/ANY`);
  await expect(request.json()).resolves.toEqual(payload);
});
