import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { deleteRestStage, deployRestApi } from './rest-stage-api';

const endpoint = 'http://127.0.0.1:9682';
const signal = new AbortController().signal;
const sent = vi.fn<(request: Request) => Response>();

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

it.each(['First deployment', ''])(
  'creates a deployment with the stage and optional description (%j)',
  async (description) => {
    sent.mockReturnValue(Response.json({ id: 'deployment-1' }));
    await deployRestApi(endpoint, 'api-1', { stageName: 'dev', description }, signal);
    expect(sent).toHaveBeenCalledOnce();
    const request = sent.mock.calls[0]?.[0];
    assert(request);
    expect(new URL(request.url).pathname).toBe('/restapis/api-1/deployments');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ stageName: 'dev', ...(description && { description }) });
  },
);

it('deletes the named stage from that API', async () => {
  sent.mockReturnValue(new Response(null, { status: 202 }));
  await deleteRestStage(endpoint, 'api-1', 'dev', signal);
  expect(sent).toHaveBeenCalledOnce();
  const request = sent.mock.calls[0]?.[0];
  assert(request);
  expect(new URL(request.url).pathname).toBe('/restapis/api-1/stages/dev');
  expect(request.method).toBe('DELETE');
});
