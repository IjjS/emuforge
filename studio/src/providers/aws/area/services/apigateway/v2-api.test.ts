import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getV2Api, readV2Integrations, readV2Routes, readV2Stages } from './v2-api';

const endpoint = 'http://127.0.0.1:9683';
const signal = new AbortController().signal;
const sent = vi.fn<(url: URL) => Response>();
const fetchEngine = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
  return sent(url);
};

beforeEach(() => {
  sent.mockReset();
  vi.stubGlobal('fetch', fetchEngine);
});

afterEach(() => vi.unstubAllGlobals());

it('gets the v2 API by ID, distinguishing a missing API from a failed read', async () => {
  sent.mockReturnValueOnce(Response.json({ apiId: 'api-1', protocolType: 'HTTP', name: 'Events' }));
  expect(await getV2Api(endpoint, 'api-1', signal)).toMatchObject({
    found: true,
    api: { ApiId: 'api-1', ProtocolType: 'HTTP', Name: 'Events' },
  });
  expect(sent.mock.calls[0]?.[0].pathname).toBe('/v2/apis/api-1');

  sent.mockReturnValueOnce(
    Response.json(
      { message: 'Invalid API identifier specified' },
      {
        status: 404,
        headers: { 'x-amzn-errortype': 'NotFoundException' },
      },
    ),
  );
  expect(await getV2Api(endpoint, 'missing', signal)).toEqual({ found: false });
});

it.each([
  ['routes', readV2Routes, { routeId: 'first' }, { RouteId: 'first' }],
  ['integrations', readV2Integrations, { integrationId: 'first' }, { IntegrationId: 'first' }],
  ['stages', readV2Stages, { stageName: 'first' }, { StageName: 'first' }],
] as const)('reads pages of %s with maxResults 100 and the previous token', async (part, read, item, decoded) => {
  sent.mockReturnValueOnce(Response.json({ items: [item], nextToken: 'after' }));
  sent.mockReturnValueOnce(Response.json({ items: [] }));

  expect(await read(endpoint, 'api-1', undefined, signal)).toEqual({ items: [decoded], next: 'after' });
  expect(await read(endpoint, 'api-1', 'after', signal)).toEqual({ items: [] });
  for (const [url] of sent.mock.calls) {
    expect(url.pathname).toBe(`/v2/apis/api-1/${part}`);
    expect(url.searchParams.get('maxResults')).toBe('100');
  }
  expect(sent.mock.calls[0]?.[0].searchParams.has('nextToken')).toBe(false);
  expect(sent.mock.calls[1]?.[0].searchParams.get('nextToken')).toBe('after');
});
