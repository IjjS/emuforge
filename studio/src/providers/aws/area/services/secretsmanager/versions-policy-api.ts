import {
  DeleteResourcePolicyCommand,
  GetResourcePolicyCommand,
  ListSecretVersionIdsCommand,
  PutResourcePolicyCommand,
  UpdateSecretVersionStageCommand,
  ValidateResourcePolicyCommand,
  type ListSecretVersionIdsCommandInput,
  type UpdateSecretVersionStageCommandInput,
} from '@aws-sdk/client-secrets-manager';

import { sendRequest } from '../../../../../lib/aws/request';
import { secretsManagerClient } from './api';

export const LIST_SECRET_VERSION_IDS = 'ListSecretVersionIds';

export function listSecretVersionIds(endpoint: string, input: ListSecretVersionIdsCommandInput, signal: AbortSignal) {
  return sendRequest(
    LIST_SECRET_VERSION_IDS,
    (abortSignal) => secretsManagerClient(endpoint).send(new ListSecretVersionIdsCommand(input), { abortSignal }),
    signal,
  );
}

export const UPDATE_SECRET_VERSION_STAGE = 'UpdateSecretVersionStage';

export function updateSecretVersionStage(
  endpoint: string,
  input: UpdateSecretVersionStageCommandInput,
  signal: AbortSignal,
) {
  return sendRequest(
    UPDATE_SECRET_VERSION_STAGE,
    (abortSignal) => secretsManagerClient(endpoint).send(new UpdateSecretVersionStageCommand(input), { abortSignal }),
    signal,
  );
}

export const GET_RESOURCE_POLICY = 'GetResourcePolicy';

export function getResourcePolicy(endpoint: string, name: string, signal: AbortSignal) {
  return sendRequest(
    GET_RESOURCE_POLICY,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(new GetResourcePolicyCommand({ SecretId: name }), { abortSignal }),
    signal,
  );
}

export const VALIDATE_RESOURCE_POLICY = 'ValidateResourcePolicy';

export function validateResourcePolicy(endpoint: string, name: string, document: string, signal: AbortSignal) {
  return sendRequest(
    VALIDATE_RESOURCE_POLICY,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(
        new ValidateResourcePolicyCommand({ SecretId: name, ResourcePolicy: document }),
        { abortSignal },
      ),
    signal,
  );
}

export const PUT_RESOURCE_POLICY = 'PutResourcePolicy';

export function putResourcePolicy(endpoint: string, name: string, document: string, signal: AbortSignal) {
  return sendRequest(
    PUT_RESOURCE_POLICY,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(new PutResourcePolicyCommand({ SecretId: name, ResourcePolicy: document }), {
        abortSignal,
      }),
    signal,
  );
}

export const DELETE_RESOURCE_POLICY = 'DeleteResourcePolicy';

export function deleteResourcePolicy(endpoint: string, name: string, signal: AbortSignal) {
  return sendRequest(
    DELETE_RESOURCE_POLICY,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(new DeleteResourcePolicyCommand({ SecretId: name }), { abortSignal }),
    signal,
  );
}
