import {
  CancelKeyDeletionCommand,
  CreateKeyCommand,
  DisableKeyCommand,
  EnableKeyCommand,
  ScheduleKeyDeletionCommand,
  UpdateKeyDescriptionCommand,
} from '@aws-sdk/client-kms';

import { RequestError, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import { sendKms } from './api';

export const LIFECYCLE_OPERATIONS = {
  create: 'CreateKey',
  describe: 'UpdateKeyDescription',
  disable: 'DisableKey',
  enable: 'EnableKey',
  schedule: 'ScheduleKeyDeletion',
  cancel: 'CancelKeyDeletion',
} as const;

export type LifecycleOperation = (typeof LIFECYCLE_OPERATIONS)[keyof typeof LIFECYCLE_OPERATIONS];

/** The waiting period KMS accepts for a scheduled deletion, in days. */
export const DELETION_WINDOW = { min: 7, max: 30 } as const;

/** Creates a single-Region symmetric encryption key with key material KMS generates, and returns its ID. */
export async function createKey(endpoint: string, description: string, signal: AbortSignal): Promise<string> {
  const operation = LIFECYCLE_OPERATIONS.create;
  const answer = await sendKms(
    endpoint,
    operation,
    (client, abortSignal) =>
      client.send(
        new CreateKeyCommand({
          Description: description === '' ? undefined : description,
          KeySpec: 'SYMMETRIC_DEFAULT',
          KeyUsage: 'ENCRYPT_DECRYPT',
          Origin: 'AWS_KMS',
          MultiRegion: false,
        }),
        { abortSignal },
      ),
    signal,
  );
  const keyId = answer.KeyMetadata?.KeyId;
  if (!keyId) throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  return keyId;
}

export function updateKeyDescription(endpoint: string, keyId: string, description: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LIFECYCLE_OPERATIONS.describe,
    (client, abortSignal) =>
      client.send(new UpdateKeyDescriptionCommand({ KeyId: keyId, Description: description }), { abortSignal }),
    signal,
  );
}

export function disableKey(endpoint: string, keyId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LIFECYCLE_OPERATIONS.disable,
    (client, abortSignal) => client.send(new DisableKeyCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
}

export function enableKey(endpoint: string, keyId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LIFECYCLE_OPERATIONS.enable,
    (client, abortSignal) => client.send(new EnableKeyCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
}

export function scheduleKeyDeletion(endpoint: string, keyId: string, days: number, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LIFECYCLE_OPERATIONS.schedule,
    (client, abortSignal) =>
      client.send(new ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: days }), { abortSignal }),
    signal,
  );
}

export function cancelKeyDeletion(endpoint: string, keyId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LIFECYCLE_OPERATIONS.cancel,
    (client, abortSignal) => client.send(new CancelKeyDeletionCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
}
