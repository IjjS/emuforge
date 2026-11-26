import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createMethod } from './method-create-api';
import type { MethodInput } from './method-form';
import { allowApiInvocation } from './permission';

vi.mock('./permission', { spy: true });

const endpoint = 'http://127.0.0.1:9682';
const api = 'my-api';
const base = '/restapis/my-api/resources/root/methods/PATCH';
const signal = new AbortController().signal;
const arn = 'arn:aws:lambda:us-west-2:123456789012:function:orders';
const sent = vi.fn<(request: Request) => Response>();
const permission = vi.mocked(allowApiInvocation);
const mockInput = {
  resource: { id: 'root', path: '/' },
  method: 'PATCH',
  authorization: 'AWS_IAM',
  apiKeyRequired: true,
  integration: { kind: 'mock', body: '{"test":true}' },
} satisfies MethodInput;

beforeEach(() => {
  sent.mockReset().mockImplementation(() => Response.json({}));
  permission.mockReset().mockResolvedValue({ kind: 'given' });
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

function paths() {
  return sent.mock.calls.map(([request]) => [request.method, new URL(request.url).pathname]);
}

function refusal(message: string) {
  return Response.json({ message }, { status: 409, headers: { 'x-amzn-errortype': 'ConflictException' } });
}

it.each([true, false])('creates the Lambda proxy before making the optional permission call (%s)', async (allow) => {
  permission.mockImplementation(async () => {
    expect(paths()).toEqual([
      ['PUT', base],
      ['PUT', `${base}/integration`],
    ]);
    return { kind: 'given' };
  });
  await expect(
    createMethod(
      endpoint,
      api,
      {
        ...mockInput,
        integration: { kind: 'lambda', function: { name: 'orders', arn }, allow },
      },
      signal,
    ),
  ).resolves.toEqual({ kind: 'created' });
  expect(paths()).toEqual([
    ['PUT', base],
    ['PUT', `${base}/integration`],
  ]);
  expect(await sent.mock.calls[0]?.[0].json()).toEqual({ authorizationType: 'AWS_IAM', apiKeyRequired: true });
  expect(await sent.mock.calls[1]?.[0].json()).toEqual({
    type: 'AWS_PROXY',
    httpMethod: 'POST',
    uri: `arn:aws:apigateway:us-west-2:lambda:path/2015-03-31/functions/${arn}/invocations`,
  });
  if (allow) expect(permission).toHaveBeenCalledExactlyOnceWith(endpoint, api, arn, signal);
  else expect(permission).not.toHaveBeenCalled();
});

it('sends an HTTP proxy with its separate method and address', async () => {
  const address = 'https://127.0.0.1:9683/_aws/execute-api/api/dev';
  await expect(
    createMethod(
      endpoint,
      api,
      {
        ...mockInput,
        integration: { kind: 'http', method: 'POST', address },
      },
      signal,
    ),
  ).resolves.toEqual({ kind: 'created' });
  expect(paths()).toEqual([
    ['PUT', base],
    ['PUT', `${base}/integration`],
  ]);
  expect(await sent.mock.calls[1]?.[0].json()).toEqual({ type: 'HTTP_PROXY', httpMethod: 'POST', uri: address });
});

it('creates a mock with its request and 200 response templates in order', async () => {
  await expect(createMethod(endpoint, api, mockInput, signal)).resolves.toEqual({ kind: 'created' });
  expect(paths()).toEqual([
    ['PUT', base],
    ['PUT', `${base}/integration`],
    ['PUT', `${base}/responses/200`],
    ['PUT', `${base}/integration/responses/200`],
  ]);
  expect(await sent.mock.calls[1]?.[0].json()).toEqual({
    type: 'MOCK',
    requestTemplates: { 'application/json': '{"statusCode": 200}' },
  });
  expect(await sent.mock.calls[3]?.[0].json()).toEqual({
    responseTemplates: { 'application/json': mockInput.integration.body },
  });
  expect(permission).not.toHaveBeenCalled();
});

it('stops after PutMethod is refused without replacing the existing method', async () => {
  sent.mockReturnValueOnce(refusal('Method already exists for this resource'));
  await expect(createMethod(endpoint, api, mockInput, signal)).resolves.toMatchObject({
    kind: 'unchanged',
    failure: { operation: 'PutMethod', message: 'Method already exists for this resource' },
  });
  expect(paths()).toEqual([['PUT', base]]);
});

const laterCalls = ['PutIntegration', 'PutMethodResponse', 'PutIntegrationResponse'] as const;
it.each(
  laterCalls.flatMap(
    (operation, index) =>
      [
        [operation, index, false],
        [operation, index, true],
      ] as const,
  ),
)(
  'takes back after %s is refused (%s successful calls before it, removal fails = %s)',
  async (operation, index, removalFails) => {
    for (let i = 0; i <= index; i++) sent.mockReturnValueOnce(Response.json({}));
    sent.mockReturnValueOnce(refusal('Write refused'));
    if (removalFails) sent.mockReturnValueOnce(refusal('Delete refused'));
    const outcome = await createMethod(endpoint, api, mockInput, signal);
    expect(outcome).toMatchObject({
      kind: removalFails ? 'left' : 'removed',
      failure: { operation, message: 'Write refused' },
      ...(removalFails ? { removalFailure: { operation: 'DeleteMethod', message: 'Delete refused' } } : {}),
    });
    expect(paths()).toHaveLength(index + 3);
    expect(paths().at(-1)).toEqual(['DELETE', base]);
    expect(permission).not.toHaveBeenCalled();
  },
);

it('keeps the method and integration when the permission cannot be added', async () => {
  permission.mockResolvedValueOnce({ kind: 'not-given', reason: 'Permission refused' });
  await expect(
    createMethod(
      endpoint,
      api,
      {
        ...mockInput,
        integration: { kind: 'lambda', function: { name: 'orders', arn }, allow: true },
      },
      signal,
    ),
  ).resolves.toEqual({
    kind: 'created',
    permissionWarning: { functionName: 'orders', reason: 'Permission refused' },
  });
  expect(paths()).toEqual([
    ['PUT', base],
    ['PUT', `${base}/integration`],
  ]);
});
