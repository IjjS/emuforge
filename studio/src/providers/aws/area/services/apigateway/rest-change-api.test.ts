import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createResource, deleteMethod, deleteResource, updateRestApi } from './rest-change-api';

const endpoint = 'http://127.0.0.1:9682';
const apiPath = '/restapis/api-1';
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

it.each([
  [
    { name: 'New', description: 'Fresh' },
    [
      { op: 'replace', path: '/name', value: 'New' },
      { op: 'replace', path: '/description', value: 'Fresh' },
    ],
  ],
  [{ name: 'New', description: 'Old description' }, [{ op: 'replace', path: '/name', value: 'New' }]],
  [{ name: 'Old', description: '' }, [{ op: 'replace', path: '/description', value: '' }]],
])('patches only fields that changed (%j)', async (fields, patchOperations) => {
  sent.mockReturnValue(Response.json(fields));
  await updateRestApi(endpoint, 'api-1', { name: 'Old', description: 'Old description' }, fields, signal);
  const request = sent.mock.calls[0]?.[0];
  if (!request) throw new Error('No request was sent');
  expect(request.method).toBe('PATCH');
  expect(new URL(request.url).pathname).toBe(apiPath);
  await expect(request.json()).resolves.toEqual({ patchOperations });
});

it('creates a resource with its parent ID and path part', async () => {
  sent.mockReturnValue(Response.json({ id: 'resource-1', path: '/orders/{id}' }));
  await expect(createResource(endpoint, 'api-1', 'parent-1', '{id}', signal)).resolves.toMatchObject({
    path: '/orders/{id}',
  });
  const request = sent.mock.calls[0]?.[0];
  if (!request) throw new Error('No request was sent');
  expect(request.method).toBe('POST');
  expect(new URL(request.url).pathname).toBe(`${apiPath}/resources/parent-1`);
  await expect(request.json()).resolves.toEqual({ pathPart: '{id}' });
});

it('deletes a resource and method by their IDs', async () => {
  sent.mockImplementation(() => new Response(null, { status: 204 }));
  await deleteResource(endpoint, 'api-1', 'resource-1', signal);
  await deleteMethod(endpoint, 'api-1', 'resource-2', 'POST', signal);
  expect(sent.mock.calls.map(([request]) => [request.method, new URL(request.url).pathname])).toEqual([
    ['DELETE', `${apiPath}/resources/resource-1`],
    ['DELETE', `${apiPath}/resources/resource-2/methods/POST`],
  ]);
});
