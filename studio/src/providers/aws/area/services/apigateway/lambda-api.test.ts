import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { addPermission, readFunctions, readPolicy } from './lambda-api';

const endpoint = 'http://127.0.0.1:9682';
const arn = 'arn:aws:lambda:us-west-2:123456789012:function:orders';
const signal = new AbortController().signal;
const sent = vi.fn<(request: Request) => Response>();

beforeEach(() => {
  sent.mockReset();
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

it('reads names and ARNs with the requested marker and a 50-function page', async () => {
  sent.mockReturnValue(
    Response.json({ Functions: [{ FunctionName: 'orders', FunctionArn: arn }], NextMarker: 'next' }),
  );
  await expect(readFunctions(endpoint, 'previous', signal)).resolves.toEqual({
    items: [{ name: 'orders', arn }],
    next: 'next',
  });
  const request = sent.mock.calls[0]?.[0];
  if (!request) throw new Error('Missing ListFunctions request');
  const url = new URL(request.url);
  expect(url.pathname).toBe('/2015-03-31/functions');
  expect(Object.fromEntries(url.searchParams)).toEqual({ MaxItems: '50', Marker: 'previous' });
});

it('sends the permission inputs and reads the policy statements or the absence of a policy', async () => {
  const input = {
    FunctionName: arn,
    Action: 'lambda:InvokeFunction',
    Principal: 'apigateway.amazonaws.com',
    SourceArn: 'arn:aws:execute-api:us-west-2:123456789012:api/*/*/*',
    StatementId: 'emuforge-apigateway-api',
  };
  const statement = { Sid: input.StatementId, Effect: 'Allow' };
  sent
    .mockReturnValueOnce(Response.json({}))
    .mockReturnValueOnce(Response.json({ Policy: JSON.stringify({ Statement: [statement] }) }))
    .mockReturnValueOnce(
      Response.json(
        { message: 'No policy' },
        {
          status: 404,
          headers: { 'x-amzn-errortype': 'ResourceNotFoundException' },
        },
      ),
    );
  await addPermission(endpoint, input, signal);
  await expect(readPolicy(endpoint, arn, signal)).resolves.toEqual([statement]);
  await expect(readPolicy(endpoint, arn, signal)).resolves.toBeNull();
  const [add, read] = sent.mock.calls.map(([request]) => request);
  const path = `/2015-03-31/functions/${encodeURIComponent(arn)}/policy`;
  if (!add || !read) throw new Error('Missing policy requests');
  expect(new URL(add.url).pathname).toBe(path);
  expect(add.method).toBe('POST');
  expect(await add.json()).toEqual({
    Action: input.Action,
    Principal: input.Principal,
    SourceArn: input.SourceArn,
    StatementId: input.StatementId,
  });
  expect(new URL(read.url).pathname).toBe(path);
  expect(read.method).toBe('GET');
});
