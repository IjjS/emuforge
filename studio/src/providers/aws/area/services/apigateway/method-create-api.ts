import {
  DeleteMethodCommand,
  PutIntegrationCommand,
  PutIntegrationResponseCommand,
  PutMethodCommand,
  PutMethodResponseCommand,
  type PutIntegrationCommandInput,
} from '@aws-sdk/client-api-gateway';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { sendRest } from './clients';
import type { MethodInput } from './method-form';
import { allowApiInvocation } from './permission';

const JSON_TYPE = 'application/json';
export const PUT_METHOD = 'PutMethod';

export type MethodOutcome =
  | { kind: 'created'; permissionWarning?: { functionName: string; reason: string; failure?: RequestFailure } }
  | { kind: 'unchanged' | 'removed'; failure: RequestFailure }
  | { kind: 'left'; failure: RequestFailure; removalFailure: RequestFailure };

function integrationInput(
  integration: MethodInput['integration'],
): Pick<PutIntegrationCommandInput, 'type' | 'uri' | 'integrationHttpMethod' | 'requestTemplates'> {
  switch (integration.kind) {
    case 'lambda': {
      const { arn } = integration.function;
      const region = arn.split(':')[3];
      return {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${arn}/invocations`,
      };
    }
    case 'http':
      return { type: 'HTTP_PROXY', integrationHttpMethod: integration.method, uri: integration.address };
    case 'mock':
      return { type: 'MOCK', requestTemplates: { [JSON_TYPE]: '{"statusCode": 200}' } };
  }
}

export async function createMethod(
  endpoint: string,
  restApiId: string,
  input: MethodInput,
  signal: AbortSignal,
): Promise<MethodOutcome> {
  const key = { restApiId, resourceId: input.resource.id, httpMethod: input.method };
  try {
    await sendRest(
      endpoint,
      PUT_METHOD,
      (client, abortSignal) =>
        client.send(
          new PutMethodCommand({
            ...key,
            authorizationType: input.authorization,
            apiKeyRequired: input.apiKeyRequired,
          }),
          { abortSignal },
        ),
      signal,
    );
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    return { kind: 'unchanged', failure: error.failure };
  }

  const { integration } = input;
  try {
    await sendRest(
      endpoint,
      'PutIntegration',
      (client, abortSignal) =>
        client.send(new PutIntegrationCommand({ ...key, ...integrationInput(integration) }), { abortSignal }),
      signal,
    );
    if (integration.kind === 'mock') {
      const response = { ...key, statusCode: '200' };
      await sendRest(
        endpoint,
        'PutMethodResponse',
        (client, abortSignal) => client.send(new PutMethodResponseCommand(response), { abortSignal }),
        signal,
      );
      await sendRest(
        endpoint,
        'PutIntegrationResponse',
        (client, abortSignal) =>
          client.send(
            new PutIntegrationResponseCommand({ ...response, responseTemplates: { [JSON_TYPE]: integration.body } }),
            { abortSignal },
          ),
        signal,
      );
    }
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    try {
      await sendRest(
        endpoint,
        'DeleteMethod',
        (client, abortSignal) => client.send(new DeleteMethodCommand(key), { abortSignal }),
        signal,
      );
    } catch (removalError) {
      if (!(removalError instanceof RequestError)) throw removalError;
      return { kind: 'left', failure: error.failure, removalFailure: removalError.failure };
    }
    return { kind: 'removed', failure: error.failure };
  }

  if (integration.kind === 'lambda' && integration.allow) {
    const permission = await allowApiInvocation(endpoint, restApiId, integration.function.arn, signal);
    if (permission.kind === 'not-given') {
      return {
        kind: 'created',
        permissionWarning: {
          functionName: integration.function.name,
          reason: permission.reason,
          ...(permission.failure && { failure: permission.failure }),
        },
      };
    }
  }
  return { kind: 'created' };
}
