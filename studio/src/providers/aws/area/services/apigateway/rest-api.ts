import {
  GetResourceCommand,
  GetResourcesCommand,
  GetRestApiCommand,
  GetStagesCommand,
  type Resource,
  type RestApi,
  type Stage,
} from '@aws-sdk/client-api-gateway';

import { RequestError } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import { sendRest } from './clients';

export const GET_REST_API = 'GetRestApi';
export const GET_RESOURCE = 'GetResource';
export const GET_RESOURCES = 'GetResources';
export const GET_REST_STAGES = 'GetStages';

async function find<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === 'NotFoundException') {
      return null;
    }
    throw error;
  }
}

export function readRestApi(endpoint: string, restApiId: string, signal: AbortSignal): Promise<RestApi | null> {
  return find(
    sendRest(
      endpoint,
      GET_REST_API,
      (client, abortSignal) => client.send(new GetRestApiCommand({ restApiId }), { abortSignal }),
      signal,
    ),
  );
}

export function readRestResource(
  endpoint: string,
  restApiId: string,
  resourceId: string,
  signal: AbortSignal,
): Promise<Resource | null> {
  return find(
    sendRest(
      endpoint,
      GET_RESOURCE,
      (client, abortSignal) => client.send(new GetResourceCommand({ restApiId, resourceId }), { abortSignal }),
      signal,
    ),
  );
}

export async function readRestResources(
  endpoint: string,
  restApiId: string,
  position: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Resource>> {
  const response = await sendRest(
    endpoint,
    GET_RESOURCES,
    (client, abortSignal) =>
      client.send(new GetResourcesCommand({ restApiId, embed: ['methods'], limit: 100, position }), { abortSignal }),
    signal,
  );
  return { items: response.items ?? [], ...(response.position && { next: response.position }) };
}

export async function readRestStages(endpoint: string, restApiId: string, signal: AbortSignal): Promise<Stage[]> {
  const response = await sendRest(
    endpoint,
    GET_REST_STAGES,
    (client, abortSignal) => client.send(new GetStagesCommand({ restApiId }), { abortSignal }),
    signal,
  );
  return response.item ?? [];
}
