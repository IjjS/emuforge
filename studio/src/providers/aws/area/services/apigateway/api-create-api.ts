import { CreateRestApiCommand } from '@aws-sdk/client-api-gateway';
import { CreateApiCommand, CreateStageCommand } from '@aws-sdk/client-apigatewayv2';

import { RequestError, UNREADABLE_ANSWER, type RequestFailure } from '../../../../../lib/aws/request';
import type { CreateApiKind, NewApi } from './api-form';
import { sendRest, sendV2 } from './clients';

export const CREATE_REST_API = 'CreateRestApi';
export const CREATE_API = 'CreateApi';
const CREATE_STAGE = 'CreateStage';

export interface CreatedApi {
  kind: CreateApiKind;
  id: string;
  name: string;
  stageFailure?: RequestFailure;
}

function apiId(id: string | undefined, operation: string): string {
  if (!id) throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  return id;
}

export async function createApi(endpoint: string, input: NewApi, signal: AbortSignal): Promise<CreatedApi> {
  const { kind, name, description } = input;
  if (kind === 'REST') {
    const rest = await sendRest(
      endpoint,
      CREATE_REST_API,
      (client, abortSignal) =>
        client.send(
          new CreateRestApiCommand({
            name,
            description: description || undefined,
            endpointConfiguration: { types: [input.endpointType] },
          }),
          { abortSignal },
        ),
      signal,
    );
    return { kind, id: apiId(rest.id, CREATE_REST_API), name: rest.name ?? name };
  }

  const http = await sendV2(
    endpoint,
    CREATE_API,
    (client, abortSignal) =>
      client.send(new CreateApiCommand({ Name: name, Description: description || undefined, ProtocolType: 'HTTP' }), {
        abortSignal,
      }),
    signal,
  );
  const created = { kind, id: apiId(http.ApiId, CREATE_API), name: http.Name ?? name };
  if (input.defaultStage === 'create') {
    try {
      await sendV2(
        endpoint,
        CREATE_STAGE,
        (client, abortSignal) =>
          client.send(new CreateStageCommand({ ApiId: created.id, StageName: '$default', AutoDeploy: true }), {
            abortSignal,
          }),
        signal,
      );
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      return { ...created, stageFailure: error.failure };
    }
  }
  return created;
}
