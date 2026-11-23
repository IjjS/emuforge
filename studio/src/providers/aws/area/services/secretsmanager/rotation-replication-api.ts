import {
  CancelRotateSecretCommand,
  RemoveRegionsFromReplicationCommand,
  ReplicateSecretToRegionsCommand,
  RotateSecretCommand,
  type ReplicaRegionType,
  type RotateSecretCommandInput,
} from '@aws-sdk/client-secrets-manager';

import { sendRequest } from '../../../../../lib/aws/request';
import { secretsManagerClient } from './api';

export const ROTATE_SECRET = 'RotateSecret';
export const CANCEL_ROTATE_SECRET = 'CancelRotateSecret';
export const REPLICATE_SECRET = 'ReplicateSecretToRegions';
export const REMOVE_REPLICA = 'RemoveRegionsFromReplication';

export function rotateSecret(endpoint: string, input: RotateSecretCommandInput, signal: AbortSignal) {
  return sendRequest(
    ROTATE_SECRET,
    (abortSignal) => secretsManagerClient(endpoint).send(new RotateSecretCommand(input), { abortSignal }),
    signal,
  );
}

export function cancelRotateSecret(endpoint: string, name: string, signal: AbortSignal) {
  return sendRequest(
    CANCEL_ROTATE_SECRET,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(new CancelRotateSecretCommand({ SecretId: name }), { abortSignal }),
    signal,
  );
}

export function replicateSecret(endpoint: string, name: string, replica: ReplicaRegionType, signal: AbortSignal) {
  return sendRequest(
    REPLICATE_SECRET,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(
        new ReplicateSecretToRegionsCommand({ SecretId: name, AddReplicaRegions: [replica] }),
        { abortSignal },
      ),
    signal,
  );
}

export function removeReplica(endpoint: string, name: string, region: string, signal: AbortSignal) {
  return sendRequest(
    REMOVE_REPLICA,
    (abortSignal) =>
      secretsManagerClient(endpoint).send(
        new RemoveRegionsFromReplicationCommand({ SecretId: name, RemoveReplicaRegions: [region] }),
        { abortSignal },
      ),
    signal,
  );
}
