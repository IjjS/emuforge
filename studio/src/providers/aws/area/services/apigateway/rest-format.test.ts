import type { Integration } from '@aws-sdk/client-api-gateway';
import { expect, it } from 'vitest';

import { orderedResources, restIntegration } from './rest-format';

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
