import type { Api, Integration, Route, Stage } from '@aws-sdk/client-apigatewayv2';

export function routeIntegrationId(route: Route): string | undefined {
  return /^integrations\/([^/]+)$/.exec(route.Target ?? '')?.[1];
}

export function routeIntegration(route: Route, integrations: readonly Integration[]) {
  const id = routeIntegrationId(route);
  const integration = id === undefined ? undefined : integrations.find((item) => item.IntegrationId === id);
  return { id, integration };
}

export function integrationRoutes(integration: Integration, routes: readonly Route[], complete: boolean) {
  const id = integration.IntegrationId;
  const keys =
    id === undefined
      ? []
      : routes.flatMap((route) =>
          route.RouteKey !== undefined && routeIntegrationId(route) === id ? [route.RouteKey] : [],
        );
  return { keys, complete };
}

export function stageInvokeAddress(api: Api, stage: Stage): string | undefined {
  if (api.ProtocolType !== 'HTTP' || !api.ApiEndpoint || !stage.StageName) return undefined;
  return stage.StageName === '$default' ? api.ApiEndpoint : `${api.ApiEndpoint.replace(/\/$/, '')}/${stage.StageName}`;
}
