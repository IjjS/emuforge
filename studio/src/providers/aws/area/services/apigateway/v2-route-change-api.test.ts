import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deleteV2Route, isIntegrationShared, updateV2Api } from './v2-route-change-api';

const endpoint = 'http://127.0.0.1:9682';
const apiPath = '/v2/apis/api-1';
const sent = vi.fn<(request: Request) => Response>();
const signal = new AbortController().signal;

beforeEach(() => {
  sent.mockReset();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Promise.resolve(Response.json({ token: 'test-session' }));
    }
    return Promise.resolve(sent(request));
  });
});
afterEach(() => vi.unstubAllGlobals());

function calls() {
  return sent.mock.calls.map(([request]) => [request.method, new URL(request.url).pathname]);
}

it('updates the name and description of the given API', async () => {
  sent.mockReturnValue(Response.json({ apiId: 'api-1', name: 'New', description: '' }));
  await updateV2Api(endpoint, 'api-1', { name: 'New', description: '' }, signal);
  expect(calls()).toEqual([['PATCH', apiPath]]);
  await expect(sent.mock.calls[0]?.[0].json()).resolves.toEqual({ name: 'New', description: '' });
});

const ownRoute = { routeId: 'r-1', target: 'integrations/i-1' };
const sharedRoute = { routeId: 'r-2', target: 'integrations/i-1' };

it.each([
  { items: [sharedRoute], nextToken: 'unused', shared: true },
  { items: [{ routeId: 'r-2', target: 'integrations/i-10' }], nextToken: undefined, shared: false },
])('reads each token until a matching other route or the last page ($shared)', async ({ items, nextToken, shared }) => {
  sent
    .mockReturnValueOnce(Response.json({ items: [ownRoute], nextToken: 'second' }))
    .mockReturnValueOnce(Response.json({ items: [], nextToken: 'third' }))
    .mockReturnValueOnce(Response.json({ items, nextToken }));
  await expect(isIntegrationShared(endpoint, 'api-1', 'r-1', 'i-1', signal)).resolves.toBe(shared);
  expect(calls()).toEqual(Array.from({ length: 3 }, () => ['GET', `${apiPath}/routes`]));
  expect(
    sent.mock.calls.map(([request]) => {
      const parameters = new URL(request.url).searchParams;
      return [parameters.get('maxResults'), parameters.get('nextToken')];
    }),
  ).toEqual([
    ['100', null],
    ['100', 'second'],
    ['100', 'third'],
  ]);
});

it.each([false, true])(
  'deletes the route and deletes its integration only when exclusive (shared: %s)',
  async (shared) => {
    sent
      .mockReturnValueOnce(Response.json({ items: shared ? [ownRoute, sharedRoute] : [ownRoute] }))
      .mockImplementation(() => new Response(null, { status: 204 }));
    const sharedIntegration = await isIntegrationShared(endpoint, 'api-1', 'r-1', 'i-1', signal);
    await expect(
      deleteV2Route(
        endpoint,
        'api-1',
        sharedIntegration ? { routeId: 'r-1' } : { routeId: 'r-1', integrationId: 'i-1' },
        signal,
      ),
    ).resolves.toBeUndefined();
    expect(calls()).toEqual([
      ['GET', `${apiPath}/routes`],
      ['DELETE', `${apiPath}/routes/r-1`],
      ...(shared ? [] : [['DELETE', `${apiPath}/integrations/i-1`]]),
    ]);
  },
);

it('does not send DeleteIntegration when DeleteRoute is refused', async () => {
  sent.mockReturnValueOnce(Response.json({ message: 'Missing route' }, { status: 404 }));
  await expect(
    deleteV2Route(endpoint, 'api-1', { routeId: 'r-1', integrationId: 'i-1' }, signal),
  ).rejects.toMatchObject({
    failure: { operation: 'DeleteRoute', message: 'Missing route' },
  });
  expect(calls()).toEqual([['DELETE', `${apiPath}/routes/r-1`]]);
});

it('returns the reason for a refused DeleteIntegration after a successful DeleteRoute', async () => {
  sent
    .mockReturnValueOnce(new Response(null, { status: 204 }))
    .mockReturnValueOnce(Response.json({ message: 'Still referenced' }, { status: 409 }));
  await expect(
    deleteV2Route(endpoint, 'api-1', { routeId: 'r-1', integrationId: 'i-1' }, signal),
  ).resolves.toMatchObject({
    integrationId: 'i-1',
    failure: { operation: 'DeleteIntegration', message: 'Still referenced' },
  });
  expect(calls()).toEqual([
    ['DELETE', `${apiPath}/routes/r-1`],
    ['DELETE', `${apiPath}/integrations/i-1`],
  ]);
});
