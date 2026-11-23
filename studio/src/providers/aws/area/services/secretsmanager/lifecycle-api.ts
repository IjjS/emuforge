import {
  CreateSecretCommand,
  type CreateSecretCommandInput,
  GetRandomPasswordCommand,
  type GetRandomPasswordCommandInput,
  UpdateSecretCommand,
  type UpdateSecretCommandInput,
  PutSecretValueCommand,
  type PutSecretValueCommandInput,
  TagResourceCommand,
  type TagResourceCommandInput,
  UntagResourceCommand,
  type UntagResourceCommandInput,
  DeleteSecretCommand,
  type DeleteSecretCommandInput,
  RestoreSecretCommand,
  type RestoreSecretCommandInput,
} from '@aws-sdk/client-secrets-manager';

import { sendRequest } from '../../../../../lib/aws/request';
import { secretsManagerClient } from './api';

export const CREATE_SECRET = 'CreateSecret';

export function createSecret(endpoint: string, input: CreateSecretCommandInput, signal: AbortSignal) {
  return sendRequest(
    CREATE_SECRET,
    (abortSignal) => secretsManagerClient(endpoint).send(new CreateSecretCommand(input), { abortSignal }),
    signal,
  );
}

export const GET_RANDOM_PASSWORD = 'GetRandomPassword';

export function getRandomPassword(endpoint: string, input: GetRandomPasswordCommandInput, signal: AbortSignal) {
  return sendRequest(
    GET_RANDOM_PASSWORD,
    (abortSignal) => secretsManagerClient(endpoint).send(new GetRandomPasswordCommand(input), { abortSignal }),
    signal,
  );
}

export const UPDATE_SECRET = 'UpdateSecret';

export function updateSecret(endpoint: string, input: UpdateSecretCommandInput, signal: AbortSignal) {
  return sendRequest(
    UPDATE_SECRET,
    (abortSignal) => secretsManagerClient(endpoint).send(new UpdateSecretCommand(input), { abortSignal }),
    signal,
  );
}

export const PUT_SECRET_VALUE = 'PutSecretValue';

export function putSecretValue(endpoint: string, input: PutSecretValueCommandInput, signal: AbortSignal) {
  return sendRequest(
    PUT_SECRET_VALUE,
    (abortSignal) => secretsManagerClient(endpoint).send(new PutSecretValueCommand(input), { abortSignal }),
    signal,
  );
}

export const TAG_RESOURCE = 'TagResource';

export function tagResource(endpoint: string, input: TagResourceCommandInput, signal: AbortSignal) {
  return sendRequest(
    TAG_RESOURCE,
    (abortSignal) => secretsManagerClient(endpoint).send(new TagResourceCommand(input), { abortSignal }),
    signal,
  );
}

export const UNTAG_RESOURCE = 'UntagResource';

export function untagResource(endpoint: string, input: UntagResourceCommandInput, signal: AbortSignal) {
  return sendRequest(
    UNTAG_RESOURCE,
    (abortSignal) => secretsManagerClient(endpoint).send(new UntagResourceCommand(input), { abortSignal }),
    signal,
  );
}

export const DELETE_SECRET = 'DeleteSecret';

export function deleteSecret(endpoint: string, input: DeleteSecretCommandInput, signal: AbortSignal) {
  return sendRequest(
    DELETE_SECRET,
    (abortSignal) => secretsManagerClient(endpoint).send(new DeleteSecretCommand(input), { abortSignal }),
    signal,
  );
}

export const RESTORE_SECRET = 'RestoreSecret';

export function restoreSecret(endpoint: string, input: RestoreSecretCommandInput, signal: AbortSignal) {
  return sendRequest(
    RESTORE_SECRET,
    (abortSignal) => secretsManagerClient(endpoint).send(new RestoreSecretCommand(input), { abortSignal }),
    signal,
  );
}
