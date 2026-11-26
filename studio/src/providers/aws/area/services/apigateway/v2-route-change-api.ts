import { DeleteIntegrationCommand, DeleteRouteCommand, UpdateApiCommand } from '@aws-sdk/client-apigatewayv2';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { sendV2 } from './clients';
import { readV2Routes } from './v2-api';

export const UPDATE_API = 'UpdateApi';
export const DELETE_ROUTE = 'DeleteRoute';
const DELETE_INTEGRATION = 'DeleteIntegration';

export interface V2ApiFields {
  name: string;
  description: string;
}

export interface RouteDeletion {
  routeId: string;
  integrationId?: string;
}

export interface IntegrationDeletionWarning {
  integrationId: string;
  failure: RequestFailure;
}

export function updateV2Api(endpoint: string, apiId: string, fields: V2ApiFields, signal: AbortSignal) {
  return sendV2(
    endpoint,
    UPDATE_API,
    (client, abortSignal) =>
      client.send(new UpdateApiCommand({ ApiId: apiId, Name: fields.name, Description: fields.description }), {
        abortSignal,
      }),
    signal,
  );
}

export async function isIntegrationShared(
  endpoint: string,
  apiId: string,
  routeId: string,
  integrationId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const target = `integrations/${integrationId}`;
  let token: string | undefined;
  do {
    const page = await readV2Routes(endpoint, apiId, token, signal);
    if (page.items.some((route) => route.RouteId !== routeId && route.Target === target)) return true;
    token = page.next;
  } while (token !== undefined);
  return false;
}

export async function deleteV2Route(
  endpoint: string,
  apiId: string,
  { routeId, integrationId }: RouteDeletion,
  signal: AbortSignal,
): Promise<IntegrationDeletionWarning | undefined> {
  await sendV2(
    endpoint,
    DELETE_ROUTE,
    (client, abortSignal) => client.send(new DeleteRouteCommand({ ApiId: apiId, RouteId: routeId }), { abortSignal }),
    signal,
  );
  if (integrationId === undefined) return;

  try {
    await sendV2(
      endpoint,
      DELETE_INTEGRATION,
      (client, abortSignal) =>
        client.send(new DeleteIntegrationCommand({ ApiId: apiId, IntegrationId: integrationId }), { abortSignal }),
      signal,
    );
  } catch (error) {
    if (error instanceof RequestError) return { integrationId, failure: error.failure };
    throw error;
  }
}
