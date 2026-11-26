import {
  CreateIntegrationCommand,
  CreateRouteCommand,
  DeleteIntegrationCommand,
  type CreateIntegrationCommandInput,
} from '@aws-sdk/client-apigatewayv2';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { sendV2 } from './clients';
import { allowApiInvocation } from './permission';
import type { RouteInput } from './route-form';

export const CREATE_INTEGRATION = 'CreateIntegration';
export const CREATE_ROUTE = 'CreateRoute';

export type RouteOutcome =
  | { kind: 'created'; permissionWarning?: { functionName: string; reason: string; failure?: RequestFailure } }
  | { kind: 'unchanged' | 'removed'; failure: RequestFailure }
  | { kind: 'left'; failure: RequestFailure; integrationId: string; removalFailure: RequestFailure };

function integrationInput(
  integration: Exclude<RouteInput['integration'], { kind: 'existing' }>,
): Omit<CreateIntegrationCommandInput, 'ApiId'> {
  if (integration.kind === 'lambda') {
    return {
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: integration.function.arn,
      PayloadFormatVersion: integration.payload,
    };
  }
  return {
    IntegrationType: 'HTTP_PROXY',
    IntegrationUri: integration.address,
    IntegrationMethod: integration.method,
    PayloadFormatVersion: '1.0',
  };
}

export async function createRoute(
  endpoint: string,
  apiId: string,
  input: RouteInput,
  signal: AbortSignal,
): Promise<RouteOutcome> {
  const { integration } = input;
  let integrationId: string;
  if (integration.kind === 'existing') {
    integrationId = integration.id;
  } else {
    try {
      const result = await sendV2(
        endpoint,
        CREATE_INTEGRATION,
        (client, abortSignal) =>
          client.send(new CreateIntegrationCommand({ ApiId: apiId, ...integrationInput(integration) }), {
            abortSignal,
          }),
        signal,
      );
      if (!result.IntegrationId) {
        throw new RequestError({
          kind: 'other',
          operation: CREATE_INTEGRATION,
          code: 'Missing integration ID',
          message: 'The emulator did not return the ID of the integration.',
        });
      }
      integrationId = result.IntegrationId;
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      return { kind: 'unchanged', failure: error.failure };
    }
  }

  try {
    await sendV2(
      endpoint,
      CREATE_ROUTE,
      (client, abortSignal) =>
        client.send(
          new CreateRouteCommand({
            ApiId: apiId,
            RouteKey: input.key,
            AuthorizationType: input.authorization,
            Target: `integrations/${integrationId}`,
          }),
          { abortSignal },
        ),
      signal,
    );
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    if (integration.kind === 'existing') return { kind: 'unchanged', failure: error.failure };

    try {
      await sendV2(
        endpoint,
        'DeleteIntegration',
        (client, abortSignal) =>
          client.send(new DeleteIntegrationCommand({ ApiId: apiId, IntegrationId: integrationId }), { abortSignal }),
        signal,
      );
    } catch (removalError) {
      if (!(removalError instanceof RequestError)) throw removalError;
      return { kind: 'left', failure: error.failure, integrationId, removalFailure: removalError.failure };
    }
    return { kind: 'removed', failure: error.failure };
  }

  if (integration.kind === 'lambda' && integration.allow) {
    const permission = await allowApiInvocation(endpoint, apiId, integration.function.arn, signal);
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
