import {
  DeleteParameterCommand,
  DeleteParametersCommand,
  DescribeParametersCommand,
  SSMClient,
  type DescribeParametersCommandInput,
} from '@aws-sdk/client-ssm';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

export const DESCRIBE_PARAMETERS = 'DescribeParameters';
export const DELETE_PARAMETER = 'DeleteParameter';
export const DELETE_PARAMETERS = 'DeleteParameters';

const clients = new Map<string, SSMClient>();

export function ssmClient(endpoint: string): SSMClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(SSMClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export function describeParameters(endpoint: string, input: DescribeParametersCommandInput, signal: AbortSignal) {
  return sendRequest(
    DESCRIBE_PARAMETERS,
    (abortSignal) => ssmClient(endpoint).send(new DescribeParametersCommand(input), { abortSignal }),
    signal,
  );
}

/** Read exact-name metadata without retrieving the parameter value. */
export async function findParameter(endpoint: string, name: string, signal: AbortSignal) {
  const ParameterFilters = [{ Key: 'Name', Option: 'Equals', Values: [name] }];
  let token: string | undefined;
  do {
    const { Parameters, NextToken } = await describeParameters(endpoint, { ParameterFilters, NextToken: token }, signal);
    signal.throwIfAborted();
    const exact = Parameters?.find((parameter) => parameter.Name === name);
    if (exact !== undefined) return exact;
    token = NextToken;
  } while (token);
  return null;
}

export function deleteParameter(endpoint: string, name: string, signal: AbortSignal) {
  return sendRequest(
    DELETE_PARAMETER,
    (abortSignal) => ssmClient(endpoint).send(new DeleteParameterCommand({ Name: name }), { abortSignal }),
    signal,
  );
}

export function deleteParameters(endpoint: string, names: string[], signal: AbortSignal) {
  return sendRequest(
    DELETE_PARAMETERS,
    (abortSignal) => ssmClient(endpoint).send(new DeleteParametersCommand({ Names: names }), { abortSignal }),
    signal,
  );
}
