import type { Integration } from '@aws-sdk/client-api-gateway';
import { expect, it } from 'vitest';

import type { AreaConnection } from '../../components/emulator-line';
import { orderedResources, restIntegration, restStageAddress } from './rest-format';

it('orders resources by path and counts their depth', () => {
  const resources = ['/pets/{id}', '/zebra', '/', '/pets'].map((path) => ({ path }));
  expect(orderedResources(resources).map(({ resource, depth }) => [resource.path, depth])).toEqual([
    ['/', 0],
    ['/pets', 1],
    ['/pets/{id}', 2],
    ['/zebra', 1],
  ]);
});

const arn = 'arn:aws:lambda:us-east-1:000000000000:function:orders:live';
const lambdaUri = `arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${arn}/invocations`;
const httpUri = 'https://127.0.0.1:9443/orders';
const sqsUri = 'arn:aws:apigateway:us-east-1:sqs:path/000000000000/orders';

it.each<[Integration | undefined, string, string | undefined]>([
  [{ type: 'AWS_PROXY', uri: lambdaUri }, 'Lambda function', arn],
  [{ type: 'AWS', uri: lambdaUri }, 'Lambda function', arn],
  [{ type: 'HTTP_PROXY', uri: httpUri }, 'HTTP endpoint', httpUri],
  [{ type: 'HTTP', uri: httpUri }, 'HTTP endpoint', httpUri],
  [{ type: 'MOCK' }, 'Mock', undefined],
  [undefined, 'No integration', undefined],
  [{ type: 'AWS_PROXY', uri: sqsUri }, 'AWS_PROXY', sqsUri],
])('presents %o as %s with its appropriate target', (integration, kind, target) => {
  expect(restIntegration(integration).kind).toBe(kind);
  expect(restIntegration(integration).target).toBe(target);
});

const endpoint = 'https://127.0.0.1:9682';
const engineOrigin = 'http://127.0.0.1:9681';

it.each([
  [endpoint, endpoint],
  [`${endpoint}/`, endpoint],
  ['https://127.0.0.2:9682', 'https://127.0.0.2:9682'],
  ['https://[::1]:9682', 'https://[::1]:9682'],
])('makes a local stage address from %s', (connectedEndpoint, base) => {
  const result = { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint: connectedEndpoint } } as const;
  expect(restStageAddress({ result, engineOrigin }, 'api-1', 'dev')).toBe(`${base}/_aws/execute-api/api-1/dev`);
});

it.each([
  'https://localhost:9682',
  'https://api-1.execute-api.us-east-1.amazonaws.com',
  'https://192.168.0.5:9682',
  'https://128.0.0.1:9682',
  'not-a-url',
  '',
])('has no local address for endpoint %j', (invalidEndpoint) => {
  const result = { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint: invalidEndpoint } } as const;
  expect(restStageAddress({ result, engineOrigin }, 'api-1', 'dev')).toBeUndefined();
});

const unavailable = {
  kind: 'emulator-unreachable',
  checkedAt: 1,
  message: '',
  emulator: { port: 9682, endpoint },
} as const;

it.each<{ state: string; result: AreaConnection['result'] }>([
  { state: 'no answer yet', result: undefined },
  { state: 'emulator not started', result: { ...unavailable, reason: 'not_started' } },
  { state: 'emulator not answering', result: { ...unavailable, reason: 'timeout' } },
  { state: 'engine not answering', result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9682 } },
  {
    state: 'engine error',
    result: { kind: 'engine-error', checkedAt: 1, status: 500, code: undefined, message: endpoint },
  },
])('has no local address with $state', ({ result }) => {
  expect(restStageAddress({ result, engineOrigin }, 'api-1', 'dev')).toBeUndefined();
});
