import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readRestApis, readV2Apis } from './apis-api';

const endpoint = 'http://127.0.0.1:9682';
const createdDate = new Date('2026-11-26T12:00:00Z');
const sent = vi.fn<(url: URL) => void>();
const bodies = new Map<string, object>();
const fetchEngine = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
  sent(url);
  return Response.json(bodies.get(url.pathname) ?? {});
};

beforeEach(() => {
  sent.mockClear();
  bodies.clear();
  vi.stubGlobal('fetch', fetchEngine);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('reads 25 REST APIs by position and returns their endpoint types and the next position', async () => {
  bodies.set('/restapis', {
    items: [
      {
        id: 'rest-1',
        name: 'Local REST',
        description: 'REST description',
        createdDate: createdDate.getTime() / 1000,
        endpointConfiguration: { types: ['REGIONAL'] },
      },
    ],
    position: 'next-position',
  });
  const page = await readRestApis(endpoint, 'current-position', new AbortController().signal);
  expect(sent.mock.calls[0]?.[0].searchParams.get('limit')).toBe('25');
  expect(sent.mock.calls[0]?.[0].searchParams.get('position')).toBe('current-position');
  expect(page).toEqual({
    next: 'next-position',
    items: [
      {
        id: 'rest-1',
        name: 'Local REST',
        kind: 'REST',
        description: 'REST description',
        createdDate,
        endpointTypes: ['REGIONAL'],
      },
    ],
  });
});

it('reads 25 v2 APIs by token and distinguishes HTTP and WebSocket rows', async () => {
  bodies.set('/v2/apis', {
    items: [
      {
        apiId: 'http-1',
        name: 'Local HTTP',
        protocolType: 'HTTP',
        description: 'HTTP description',
        createdDate: createdDate.toISOString(),
      },
      { apiId: 'ws-1', name: 'Local WebSocket', protocolType: 'WEBSOCKET' },
    ],
    nextToken: 'further-token',
  });
  const page = await readV2Apis(endpoint, 'current-token', new AbortController().signal);
  expect(sent.mock.calls[0]?.[0].searchParams.get('maxResults')).toBe('25');
  expect(sent.mock.calls[0]?.[0].searchParams.get('nextToken')).toBe('current-token');
  expect(page).toEqual({
    next: 'further-token',
    items: [
      {
        id: 'http-1',
        name: 'Local HTTP',
        kind: 'HTTP',
        description: 'HTTP description',
        createdDate,
        endpointTypes: [],
      },
      {
        id: 'ws-1',
        name: 'Local WebSocket',
        kind: 'WebSocket',
        description: undefined,
        createdDate: undefined,
        endpointTypes: [],
      },
    ],
  });
});
