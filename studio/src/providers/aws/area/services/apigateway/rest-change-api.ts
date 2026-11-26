import {
  CreateResourceCommand,
  DeleteMethodCommand,
  DeleteResourceCommand,
  UpdateRestApiCommand,
  type PatchOperation,
} from '@aws-sdk/client-api-gateway';

import { sendRest } from './clients';

export const UPDATE_REST_API = 'UpdateRestApi';
export const CREATE_RESOURCE = 'CreateResource';
export const DELETE_RESOURCE = 'DeleteResource';
export const DELETE_METHOD = 'DeleteMethod';

export interface RestApiFields {
  name: string;
  description: string;
}

export function updateRestApi(
  endpoint: string,
  restApiId: string,
  previous: RestApiFields,
  fields: RestApiFields,
  signal: AbortSignal,
) {
  const patchOperations: PatchOperation[] = [];
  for (const field of ['name', 'description'] as const) {
    if (fields[field] !== previous[field]) {
      patchOperations.push({ op: 'replace', path: `/${field}`, value: fields[field] });
    }
  }

  return sendRest(
    endpoint,
    UPDATE_REST_API,
    (client, abortSignal) => client.send(new UpdateRestApiCommand({ restApiId, patchOperations }), { abortSignal }),
    signal,
  );
}

export function createResource(
  endpoint: string,
  restApiId: string,
  parentId: string,
  pathPart: string,
  signal: AbortSignal,
) {
  return sendRest(
    endpoint,
    CREATE_RESOURCE,
    (client, abortSignal) => client.send(new CreateResourceCommand({ restApiId, parentId, pathPart }), { abortSignal }),
    signal,
  );
}

export function deleteResource(endpoint: string, restApiId: string, resourceId: string, signal: AbortSignal) {
  return sendRest(
    endpoint,
    DELETE_RESOURCE,
    (client, abortSignal) => client.send(new DeleteResourceCommand({ restApiId, resourceId }), { abortSignal }),
    signal,
  );
}

export function deleteMethod(
  endpoint: string,
  restApiId: string,
  resourceId: string,
  httpMethod: string,
  signal: AbortSignal,
) {
  return sendRest(
    endpoint,
    DELETE_METHOD,
    (client, abortSignal) =>
      client.send(new DeleteMethodCommand({ restApiId, resourceId, httpMethod }), { abortSignal }),
    signal,
  );
}
