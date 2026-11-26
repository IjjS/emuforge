import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { createV2Stage, deleteV2Stage, deployV2Stage } from './v2-stage-api';

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

function requestSent(method: string, pathname: string) {
  expect(sent).toHaveBeenCalledOnce();
  const request = sent.mock.calls[0]?.[0];
  assert(request);
  expect(new URL(request.url).pathname).toBe(pathname);
  expect(request.method).toBe(method);
  return request;
}

it.each([true, false])('creates the named stage with auto-deploy %s', async (autoDeploy) => {
  sent.mockReturnValue(Response.json({ stageName: 'dev', autoDeploy }));
  await createV2Stage(endpoint, 'api-1', { stageName: 'dev', autoDeploy }, signal);
  expect(await requestSent('POST', '/v2/apis/api-1/stages').json()).toEqual({ stageName: 'dev', autoDeploy });
});

it('creates a deployment for the named stage', async () => {
  sent.mockReturnValue(Response.json({ deploymentId: 'd-1' }));
  await deployV2Stage(endpoint, 'api-1', 'dev', signal);
  expect(await requestSent('POST', '/v2/apis/api-1/deployments').json()).toEqual({ stageName: 'dev' });
});

it('deletes the named stage from that API', async () => {
  sent.mockReturnValue(new Response(null, { status: 204 }));
  await deleteV2Stage(endpoint, 'api-1', 'dev', signal);
  requestSent('DELETE', '/v2/apis/api-1/stages/dev');
});
