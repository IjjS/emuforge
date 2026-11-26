import { expect, it } from 'vitest';

import { integrationRoutes, routeIntegration, stageInvokeAddress } from './v2-format';

it('resolves an integration among the pages read, or returns only its ID', () => {
  const route = { Target: 'integrations/i-2' };
  const integration = { IntegrationId: 'i-2', IntegrationType: 'MOCK' } as const;
  const firstPage = [{ IntegrationId: 'i-1' }];

  expect(routeIntegration(route, firstPage)).toEqual({ id: 'i-2', integration: undefined });
  expect(routeIntegration(route, [...firstPage, integration])).toEqual({ id: 'i-2', integration });
  expect(routeIntegration({}, firstPage)).toEqual({ id: undefined, integration: undefined });
});

it('lists the keys of routes targeting an integration and carries whether the list is complete', () => {
  const integration = { IntegrationId: 'i-2' };
  const routes = [
    { RouteKey: 'GET /other', Target: 'integrations/i-1' },
    { RouteKey: 'GET /events', Target: 'integrations/i-2' },
    { RouteKey: '$default', Target: 'integrations/i-2' },
  ];
  expect(integrationRoutes(integration, routes.slice(0, 2), false)).toEqual({
    keys: ['GET /events'],
    complete: false,
  });
  expect(integrationRoutes(integration, routes, true)).toEqual({
    keys: ['GET /events', '$default'],
    complete: true,
  });
});

it('derives HTTP invoke addresses for default and named stages and omits WebSocket addresses', () => {
  const api = { ProtocolType: 'HTTP', ApiEndpoint: 'https://127.0.0.1:9323/_aws/execute-api/api-1' } as const;
  expect(stageInvokeAddress(api, { StageName: '$default' })).toBe(api.ApiEndpoint);
  expect(stageInvokeAddress(api, { StageName: 'dev' })).toBe(`${api.ApiEndpoint}/dev`);
  expect(stageInvokeAddress({ ...api, ProtocolType: 'WEBSOCKET' }, { StageName: 'dev' })).toBeUndefined();
});
