import { expect, it } from 'vitest';

import {
  apiKindText,
  apisPath,
  createApiPath,
  createMethodPath,
  createRoutePath,
  endpointTypeText,
  integrationTypeText,
  restApiPath,
  servicePath,
  v2ApiPath,
} from './format';

it('addresses the APIs and their forms by model, with optional section and resource queries', () => {
  const id = 'abc123';
  expect(servicePath).toBe('/aws/apigateway');
  expect(apisPath).toBe('/aws/apigateway/apis');
  expect(createApiPath).toBe('/aws/apigateway/apis/create');
  expect(restApiPath(id)).toBe('/aws/apigateway/apis/rest/abc123');
  expect(restApiPath(id, 'resources')).toBe('/aws/apigateway/apis/rest/abc123?show=resources');
  expect(createMethodPath(id)).toBe('/aws/apigateway/apis/rest/abc123/methods/create');
  expect(createMethodPath(id, 'a/b')).toBe('/aws/apigateway/apis/rest/abc123/methods/create?resource=a%2Fb');
  expect(v2ApiPath(id)).toBe('/aws/apigateway/apis/v2/abc123');
  expect(v2ApiPath(id, 'integrations')).toBe('/aws/apigateway/apis/v2/abc123?show=integrations');
  expect(createRoutePath(id)).toBe('/aws/apigateway/apis/v2/abc123/routes/create');
});

it('uses the service words for known kinds, retaining other integration types', () => {
  expect((['REST', 'HTTP', 'WEBSOCKET'] as const).map(apiKindText)).toEqual(['REST', 'HTTP', 'WebSocket']);
  expect(['EDGE', 'REGIONAL', 'PRIVATE'].map(endpointTypeText)).toEqual(['Edge-optimized', 'Regional', 'Private']);
  expect(['AWS_PROXY', 'HTTP_PROXY', 'MOCK', 'AWS', 'HTTP'].map(integrationTypeText)).toEqual([
    'Lambda function',
    'HTTP endpoint',
    'Mock',
    'AWS',
    'HTTP',
  ]);
});
