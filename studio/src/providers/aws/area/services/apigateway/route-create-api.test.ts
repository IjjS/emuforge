import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createRoute } from './route-create-api';
import type { RouteInput } from './route-form';

const endpoint = 'http://127.0.0.1:9682';
const api = 'my-api';
const integrations = `/v2/apis/${api}/integrations`;
const routes = `/v2/apis/${api}/routes`;
const arn = 'arn:aws:lambda:us-west-2:123456789012:function:orders';
const functionPolicy = `/2015-03-31/functions/${encodeURIComponent(arn)}/policy`;
const signal = new AbortController().signal;
const sent = vi.fn<(request: Request) => Response>();
const existing = {
  key: '$default',
  authorization: 'AWS_IAM',
  integration: { kind: 'existing', id: 'int-1' },
} satisfies RouteInput;
const http = {
  ...existing,
  key: 'GET /orders',
  integration: { kind: 'http', address: 'https://127.0.0.1:9682/orders', method: 'PATCH' },
} satisfies RouteInput;

beforeEach(() => {
  sent
    .mockReset()
    .mockImplementation((request) =>
      Response.json(new URL(request.url).pathname === integrations ? { integrationId: 'int-new' } : {}),
    );
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return Promise.resolve(
      new URL(request.url).pathname === '/__emuforge/session'
        ? Response.json({ token: 'test-session' })
        : sent(request),
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

function calls() {
  return sent.mock.calls.map(([request]) => [request.method, new URL(request.url).pathname]);
}

function refusal(code: string, message: string, status = 409) {
  return Response.json({ message }, { status, headers: { 'x-amzn-errortype': code } });
}

it('creates a route alone for an existing integration without reading or changing its Lambda policy', async () => {
  await expect(createRoute(endpoint, api, existing, signal)).resolves.toEqual({ kind: 'created' });
  expect(calls()).toEqual([['POST', routes]]);
  expect(await sent.mock.calls[0]?.[0].json()).toEqual({
    routeKey: '$default',
    authorizationType: 'AWS_IAM',
    target: 'integrations/int-1',
  });
});

it.each([true, false])('creates the Lambda integration and route before optional permission (%s)', async (allow) => {
  const input: RouteInput = {
    ...existing,
    integration: { kind: 'lambda', function: { name: 'orders', arn }, payload: '1.0', allow },
  };
  await expect(createRoute(endpoint, api, input, signal)).resolves.toEqual({ kind: 'created' });
  expect(calls()).toEqual([['POST', integrations], ['POST', routes], ...(allow ? [['POST', functionPolicy]] : [])]);
  expect(await sent.mock.calls[0]?.[0].json()).toEqual({
    integrationType: 'AWS_PROXY',
    integrationUri: arn,
    payloadFormatVersion: '1.0',
  });
  expect(await sent.mock.calls[1]?.[0].json()).toMatchObject({ target: 'integrations/int-new' });
  if (allow) {
    expect(await sent.mock.calls[2]?.[0].json()).toEqual({
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      SourceArn: 'arn:aws:execute-api:us-west-2:123456789012:my-api/*/*/*',
      StatementId: 'emuforge-apigateway-my-api',
    });
  }
});

it('creates an HTTP proxy with its own method and payload 1.0', async () => {
  await expect(createRoute(endpoint, api, http, signal)).resolves.toEqual({ kind: 'created' });
  expect(calls()).toEqual([
    ['POST', integrations],
    ['POST', routes],
  ]);
  expect(await sent.mock.calls[0]?.[0].json()).toEqual({
    integrationType: 'HTTP_PROXY',
    integrationUri: http.integration.address,
    integrationMethod: 'PATCH',
    payloadFormatVersion: '1.0',
  });
});

it('stops on a refused integration', async () => {
  sent.mockReturnValueOnce(refusal('BadRequestException', 'Invalid target', 400));
  await expect(createRoute(endpoint, api, http, signal)).resolves.toMatchObject({
    kind: 'unchanged',
    failure: { operation: 'CreateIntegration', code: 'BadRequestException', message: 'Invalid target' },
  });
  expect(calls()).toEqual([['POST', integrations]]);
});

it.each([false, true])('takes back its new integration after route refusal (removal refused = %s)', async (left) => {
  sent.mockReturnValueOnce(Response.json({ integrationId: 'int-new' }));
  sent.mockReturnValueOnce(refusal('ConflictException', 'Route already exists'));
  if (left) sent.mockReturnValueOnce(refusal('BadRequestException', 'Could not remove integration', 400));
  await expect(createRoute(endpoint, api, http, signal)).resolves.toMatchObject({
    kind: left ? 'left' : 'removed',
    failure: { operation: 'CreateRoute', code: 'ConflictException', message: 'Route already exists' },
    ...(left && {
      integrationId: 'int-new',
      removalFailure: { operation: 'DeleteIntegration', message: 'Could not remove integration' },
    }),
  });
  expect(calls()).toEqual([
    ['POST', integrations],
    ['POST', routes],
    ['DELETE', `${integrations}/int-new`],
  ]);
});

it('leaves an existing integration alone if the route is refused', async () => {
  sent.mockReturnValueOnce(refusal('ConflictException', 'Route already exists'));
  await expect(createRoute(endpoint, api, existing, signal)).resolves.toMatchObject({
    kind: 'unchanged',
    failure: { operation: 'CreateRoute', code: 'ConflictException' },
  });
  expect(calls()).toEqual([['POST', routes]]);
});

it('keeps the route and integration when permission is refused and returns its reason', async () => {
  sent.mockReturnValueOnce(Response.json({ integrationId: 'int-new' }));
  sent.mockReturnValueOnce(Response.json({ routeId: 'route-new' }));
  sent.mockReturnValueOnce(refusal('AccessDeniedException', 'Permission refused', 403));
  await expect(
    createRoute(
      endpoint,
      api,
      { ...existing, integration: { kind: 'lambda', function: { name: 'orders', arn }, payload: '2.0', allow: true } },
      signal,
    ),
  ).resolves.toMatchObject({
    kind: 'created',
    permissionWarning: { functionName: 'orders', reason: 'AddPermission: Permission refused' },
  });
  expect(calls()).toEqual([
    ['POST', integrations],
    ['POST', routes],
    ['POST', functionPolicy],
  ]);
});

it.each(['AddPermission', 'GetPolicy'])('keeps the route and preserves a 501 from %s', async (operation) => {
  sent.mockReturnValueOnce(Response.json({ integrationId: 'int-new' }));
  sent.mockReturnValueOnce(Response.json({ routeId: 'route-new' }));
  if (operation === 'GetPolicy') {
    sent.mockReturnValueOnce(refusal('ResourceConflictException', 'The statement already exists'));
  }
  sent.mockReturnValueOnce(Response.json({ message: 'Not Implemented' }, { status: 501 }));

  const input: RouteInput = {
    ...existing,
    integration: { kind: 'lambda', function: { name: 'orders', arn }, payload: '2.0', allow: true },
  };
  await expect(createRoute(endpoint, api, input, signal)).resolves.toEqual({
    kind: 'created',
    permissionWarning: {
      functionName: 'orders',
      reason: `${operation}: 501 Not Implemented`,
      failure: { kind: 'not-implemented', operation },
    },
  });
  expect(calls()).toEqual([
    ['POST', integrations],
    ['POST', routes],
    ['POST', functionPolicy],
    ...(operation === 'GetPolicy' ? [['GET', functionPolicy]] : []),
  ]);
});
