import { GetRestApisCommand } from '@aws-sdk/client-api-gateway';
import { GetApisCommand } from '@aws-sdk/client-apigatewayv2';

import type { TokenPage } from '../../components/use-token-listing';
import { sendRest, sendV2 } from './clients';
import { apiKindText, type ApiKind } from './format';

export const GET_REST_APIS = 'GetRestApis';
export const GET_APIS = 'GetApis';

const PAGE_SIZE = 25;

export interface ApiRow {
  id: string;
  name: string;
  kind: ApiKind;
  description: string | undefined;
  createdDate: Date | undefined;
  endpointTypes: readonly string[];
}

export async function readRestApis(
  endpoint: string,
  position: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<ApiRow>> {
  const response = await sendRest(
    endpoint,
    GET_REST_APIS,
    (client, abortSignal) => client.send(new GetRestApisCommand({ limit: PAGE_SIZE, position }), { abortSignal }),
    signal,
  );
  return {
    items: (response.items ?? []).flatMap((api) =>
      api.id === undefined
        ? []
        : [
            {
              id: api.id,
              name: api.name ?? api.id,
              kind: 'REST',
              description: api.description,
              createdDate: api.createdDate,
              endpointTypes: api.endpointConfiguration?.types ?? [],
            },
          ],
    ),
    ...(response.position && { next: response.position }),
  };
}

export async function readV2Apis(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<ApiRow>> {
  const response = await sendV2(
    endpoint,
    GET_APIS,
    (client, abortSignal) =>
      client.send(new GetApisCommand({ MaxResults: String(PAGE_SIZE), NextToken: token }), { abortSignal }),
    signal,
  );
  return {
    items: (response.Items ?? []).flatMap((api) =>
      api.ApiId === undefined || (api.ProtocolType !== 'HTTP' && api.ProtocolType !== 'WEBSOCKET')
        ? []
        : [
            {
              id: api.ApiId,
              name: api.Name ?? api.ApiId,
              kind: apiKindText(api.ProtocolType),
              description: api.Description,
              createdDate: api.CreatedDate,
              endpointTypes: [],
            },
          ],
    ),
    ...(response.NextToken && { next: response.NextToken }),
  };
}
