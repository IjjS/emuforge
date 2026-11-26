import { GetRestApisCommand } from '@aws-sdk/client-api-gateway';
import { GetApisCommand } from '@aws-sdk/client-apigatewayv2';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { sendRest, sendV2 } from './clients';

const endpoint = 'http://127.0.0.1:9681';
const answer = vi.fn<() => Promise<Response>>();
const fetchEngine = vi.fn(async (input: RequestInfo | URL) => {
  const address = new URL(input instanceof Request ? input.url : String(input));
  if (address.pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
  return answer();
});

const rest = (signal: AbortSignal) =>
  sendRest(
    endpoint,
    'GetRestApis',
    (client, abortSignal) => client.send(new GetRestApisCommand({}), { abortSignal }),
    signal,
  );
const v2 = (signal: AbortSignal) =>
  sendV2(endpoint, 'GetApis', (client, abortSignal) => client.send(new GetApisCommand({}), { abortSignal }), signal);

beforeEach(() => {
  fetchEngine.mockClear();
  answer.mockReset().mockImplementation(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchEngine);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('sends both SDK requests through the engine', async () => {
  const { signal } = new AbortController();
  await Promise.all([rest(signal), v2(signal)]);
  const urls = fetchEngine.mock.calls.map(
    ([request]) => new URL(request instanceof Request ? request.url : String(request)),
  );
  expect(urls.every((url) => url.origin === endpoint)).toBe(true);
  expect(urls.map(({ pathname }) => pathname)).toEqual(expect.arrayContaining(['/restapis', '/v2/apis']));
});

it.each([
  ['GetRestApis', rest],
  ['GetApis', v2],
] as const)('names a shared failure for %s', async (operation, send) => {
  answer.mockImplementation(async () => Response.json({ message: 'Unavailable' }, { status: 501 }));
  await expect(send(new AbortController().signal)).rejects.toMatchObject({
    failure: { kind: 'not-implemented', operation },
  });
});

it.each([
  ['REST', rest],
  ['v2', v2],
] as const)('ends an in-flight %s request on abort', async (_, send) => {
  answer.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  const request = send(controller.signal);
  await vi.waitFor(() => {
    expect(answer).toHaveBeenCalledOnce();
  });
  controller.abort();
  await expect(request).rejects.toBe(controller.signal.reason);
});
