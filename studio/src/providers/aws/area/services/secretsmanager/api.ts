import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient,
  type GetSecretValueCommandInput,
  type ListSecretsCommandInput,
} from '@aws-sdk/client-secrets-manager';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

export const LIST_SECRETS = 'ListSecrets';
export const DESCRIBE_SECRET = 'DescribeSecret';
export const GET_SECRET_VALUE = 'GetSecretValue';

const clients = new Map<string, SecretsManagerClient>();

export function secretsManagerClient(endpoint: string): SecretsManagerClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(SecretsManagerClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export function listSecrets(endpoint: string, input: ListSecretsCommandInput, signal: AbortSignal) {
  return sendRequest(
    LIST_SECRETS,
    (abortSignal) => secretsManagerClient(endpoint).send(new ListSecretsCommand(input), { abortSignal }),
    signal,
  );
}

export function describeSecret(endpoint: string, name: string, signal: AbortSignal) {
  return sendRequest(
    DESCRIBE_SECRET,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(new DescribeSecretCommand({ SecretId: name }), { abortSignal }),
    signal,
  );
}

export function getSecretValue(endpoint: string, input: GetSecretValueCommandInput, signal: AbortSignal) {
  return sendRequest(
    GET_SECRET_VALUE,
    (abortSignal) => secretsManagerClient(endpoint).send(new GetSecretValueCommand(input), { abortSignal }),
    signal,
  );
}
