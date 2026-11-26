import { AddPermissionCommand, GetPolicyCommand, LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';

export const LIST_FUNCTIONS = 'ListFunctions';
export const ADD_PERMISSION = 'AddPermission';
export const GET_POLICY = 'GetPolicy';

export interface LambdaFunction {
  name: string;
  arn: string;
}

function sendLambda<T>(
  endpoint: string,
  operation: string,
  send: (client: LambdaClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(LambdaClient, { endpoint }), abort), signal);
}

export async function readFunctions(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<LambdaFunction>> {
  const response = await sendLambda(
    endpoint,
    LIST_FUNCTIONS,
    (client, abortSignal) => client.send(new ListFunctionsCommand({ MaxItems: 50, Marker: marker }), { abortSignal }),
    signal,
  );
  return {
    items: (response.Functions ?? []).flatMap(({ FunctionName, FunctionArn }) =>
      FunctionName && FunctionArn ? [{ name: FunctionName, arn: FunctionArn }] : [],
    ),
    ...(response.NextMarker && { next: response.NextMarker }),
  };
}

export async function addPermission(
  endpoint: string,
  input: { FunctionName: string; Action: string; Principal: string; SourceArn: string; StatementId: string },
  signal: AbortSignal,
): Promise<void> {
  await sendLambda(
    endpoint,
    ADD_PERMISSION,
    (client, abortSignal) => client.send(new AddPermissionCommand(input), { abortSignal }),
    signal,
  );
}

export async function readPolicy(
  endpoint: string,
  functionArn: string,
  signal: AbortSignal,
): Promise<unknown[] | null> {
  let policy: string | undefined;
  try {
    ({ Policy: policy } = await sendLambda(
      endpoint,
      GET_POLICY,
      (client, abortSignal) => client.send(new GetPolicyCommand({ FunctionName: functionArn }), { abortSignal }),
      signal,
    ));
  } catch (error) {
    if (
      error instanceof RequestError &&
      error.failure.kind === 'other' &&
      error.failure.code === 'ResourceNotFoundException'
    ) {
      return null;
    }
    throw error;
  }
  const document: unknown = JSON.parse(policy ?? '');
  if (typeof document !== 'object' || document === null || !('Statement' in document)) {
    throw new Error('The policy has no Statement field.');
  }
  const { Statement } = document;
  if (Array.isArray(Statement)) return Statement;
  if (typeof Statement === 'object' && Statement !== null) return [Statement];
  throw new Error('The policy has an invalid Statement field.');
}
