import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readRestApi, readRestResource, readRestResources, readRestStages } from './rest-api';

const endpoint = 'http://127.0.0.1:9682';
const apiPath = '/restapis/api-1';
const sent = vi.fn<(url: URL, request: Request) => Response>();
const signal = new AbortController().signal;

beforeEach(() => {
  sent.mockReset();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') return Promise.resolve(Response.json({ token: 'test-session' }));
    return Promise.resolve(sent(url, request));
  });
});
afterEach(() => vi.unstubAllGlobals());

function notFound() {
  return Response.json(
    { message: 'Invalid API identifier specified' },
    {
      status: 404,
      headers: { 'x-amzn-errortype': 'NotFoundException' },
    },
  );
}

it('reads one REST API by ID and treats the emulator’s NotFoundException as absence', async () => {
  sent.mockReturnValueOnce(Response.json({ id: 'api-1', name: 'Orders' })).mockReturnValueOnce(notFound());
  await expect(readRestApi(endpoint, 'api-1', signal)).resolves.toMatchObject({ id: 'api-1', name: 'Orders' });
  expect(sent.mock.calls[0]?.[0].pathname).toBe(apiPath);
  expect(sent.mock.calls[0]?.[1].method).toBe('GET');
  await expect(readRestApi(endpoint, 'missing', signal)).resolves.toBeNull();
});

it('reads a linked resource by ID and treats NotFoundException as absence', async () => {
  sent.mockReturnValueOnce(Response.json({ id: 'resource-1', path: '/orders' })).mockReturnValueOnce(notFound());
  await expect(readRestResource(endpoint, 'api-1', 'resource-1', signal)).resolves.toMatchObject({ path: '/orders' });
  expect(sent.mock.calls[0]?.[0].pathname).toBe(`${apiPath}/resources/resource-1`);
  await expect(readRestResource(endpoint, 'api-1', 'missing', signal)).resolves.toBeNull();
});

it('uses the position, page limit and embedded methods, retaining both kinds of responses', async () => {
  const method = {
    httpMethod: 'GET',
    authorizationType: 'NONE',
    methodResponses: { '200': { statusCode: '200' } },
    methodIntegration: {
      type: 'HTTP_PROXY',
      uri: 'http://127.0.0.1/orders',
      connectionType: 'INTERNET',
      integrationResponses: { '200': { statusCode: '200', responseTemplates: { 'text/plain': 'ok' } } },
    },
  };
  sent.mockReturnValueOnce(
    Response.json({
      position: 'next-page',
      item: [{ id: 'resource-1', path: '/orders', resourceMethods: { GET: method } }],
    }),
  );
  const page = await readRestResources(endpoint, 'api-1', 'current-page', signal);
  const url = sent.mock.calls[0]?.[0];
  expect(url?.pathname).toBe(`${apiPath}/resources`);
  expect(url?.searchParams.getAll('embed')).toEqual(['methods']);
  expect(url?.searchParams.get('limit')).toBe('100');
  expect(url?.searchParams.get('position')).toBe('current-page');
  expect(page).toMatchObject({
    next: 'next-page',
    items: [{ id: 'resource-1', path: '/orders', resourceMethods: { GET: method } }],
  });
});

it('reads the stages as returned by the emulator in one GetStages request', async () => {
  const changed = new Date('2026-11-26T12:00:00Z');
  const dev = { stageName: 'dev', deploymentId: 'deploy-1' };
  const prod = { stageName: 'prod', deploymentId: 'deploy-2' };
  sent.mockReturnValueOnce(Response.json({ item: [{ ...dev, lastUpdatedDate: changed.getTime() / 1000 }, prod] }));

  await expect(readRestStages(endpoint, 'api-1', signal)).resolves.toEqual([
    { ...dev, lastUpdatedDate: changed },
    prod,
  ]);
  expect(sent).toHaveBeenCalledOnce();
  expect(sent.mock.calls[0]?.[0].pathname).toBe(`${apiPath}/stages`);
  expect(sent.mock.calls[0]?.[1].method).toBe('GET');
});
