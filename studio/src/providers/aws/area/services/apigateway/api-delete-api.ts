import { DeleteRestApiCommand } from '@aws-sdk/client-api-gateway';
import { DeleteApiCommand } from '@aws-sdk/client-apigatewayv2';

import type { ApiRow } from './apis-api';
import { sendRest, sendV2 } from './clients';

export type DeleteApiTarget = Pick<ApiRow, 'id' | 'kind' | 'name'>;

export function deleteApiModel(kind: DeleteApiTarget['kind']) {
  return kind === 'REST' ? 'rest' : 'v2';
}

export function deleteApiOperation(kind: DeleteApiTarget['kind']) {
  return deleteApiModel(kind) === 'rest' ? 'DeleteRestApi' : 'DeleteApi';
}

export async function deleteApi(endpoint: string, api: DeleteApiTarget, signal: AbortSignal): Promise<void> {
  const operation = deleteApiOperation(api.kind);
  if (operation === 'DeleteRestApi') {
    await sendRest(
      endpoint,
      operation,
      (client, abortSignal) => client.send(new DeleteRestApiCommand({ restApiId: api.id }), { abortSignal }),
      signal,
    );
  } else {
    await sendV2(
      endpoint,
      operation,
      (client, abortSignal) => client.send(new DeleteApiCommand({ ApiId: api.id }), { abortSignal }),
      signal,
    );
  }
}
