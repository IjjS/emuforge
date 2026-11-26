import {
  GetApiCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  type Api,
  type Integration,
  type Route,
  type Stage,
} from '@aws-sdk/client-apigatewayv2';

import { RequestError } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import { sendV2 } from './clients';

export const GET_API = 'GetApi';
export const GET_ROUTES = 'GetRoutes';
export const GET_INTEGRATIONS = 'GetIntegrations';
export const GET_STAGES = 'GetStages';

const PAGE_SIZE = '100';

export type V2ApiRead = { found: true; api: Api } | { found: false };

export async function getV2Api(endpoint: string, id: string, signal: AbortSignal): Promise<V2ApiRead> {
  try {
    const api = await sendV2(
      endpoint,
      GET_API,
      (client, abortSignal) => client.send(new GetApiCommand({ ApiId: id }), { abortSignal }),
      signal,
    );
    return { found: true, api };
  } catch (error) {
    if (error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === 'NotFoundException') {
      return { found: false };
    }
    throw error;
  }
}

function toPage<T>(response: { Items?: T[]; NextToken?: string }): TokenPage<T> {
  return { items: response.Items ?? [], ...(response.NextToken && { next: response.NextToken }) };
}

export async function readV2Routes(
  endpoint: string,
  id: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Route>> {
  const response = await sendV2(
    endpoint,
    GET_ROUTES,
    (client, abortSignal) =>
      client.send(new GetRoutesCommand({ ApiId: id, MaxResults: PAGE_SIZE, NextToken: token }), { abortSignal }),
    signal,
  );
  return toPage(response);
}

export async function readV2Integrations(
  endpoint: string,
  id: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Integration>> {
  const response = await sendV2(
    endpoint,
    GET_INTEGRATIONS,
    (client, abortSignal) =>
      client.send(new GetIntegrationsCommand({ ApiId: id, MaxResults: PAGE_SIZE, NextToken: token }), { abortSignal }),
    signal,
  );
  return toPage(response);
}

export async function readV2Stages(
  endpoint: string,
  id: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Stage>> {
  const response = await sendV2(
    endpoint,
    GET_STAGES,
    (client, abortSignal) =>
      client.send(new GetStagesCommand({ ApiId: id, MaxResults: PAGE_SIZE, NextToken: token }), { abortSignal }),
    signal,
  );
  return toPage(response);
}
