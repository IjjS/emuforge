import {
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyRotationStatusCommand,
  ListKeyRotationsCommand,
  RotateKeyOnDemandCommand,
  type RotationsListEntry,
} from '@aws-sdk/client-kms';

import type { TokenPage } from '../../components/use-token-listing';
import { sendKms } from './api';

export const ROTATION_OPERATIONS = {
  status: 'GetKeyRotationStatus',
  history: 'ListKeyRotations',
  enable: 'EnableKeyRotation',
  disable: 'DisableKeyRotation',
  rotate: 'RotateKeyOnDemand',
} as const;

export type RotationAction = 'enable' | 'disable' | 'rotate';

const rotationCommands = {
  enable: EnableKeyRotationCommand,
  disable: DisableKeyRotationCommand,
  rotate: RotateKeyOnDemandCommand,
};

export function getKeyRotationStatus(endpoint: string, keyId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    ROTATION_OPERATIONS.status,
    (client, abortSignal) => client.send(new GetKeyRotationStatusCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
}

export async function listKeyRotations(
  endpoint: string,
  keyId: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<RotationsListEntry>> {
  const response = await sendKms(
    endpoint,
    ROTATION_OPERATIONS.history,
    (client, abortSignal) =>
      client.send(new ListKeyRotationsCommand({ KeyId: keyId, Marker: marker }), { abortSignal }),
    signal,
  );
  const items = response.Rotations ?? [];
  return response.Truncated && response.NextMarker ? { items, next: response.NextMarker } : { items };
}

export async function changeKeyRotation(endpoint: string, keyId: string, action: RotationAction, signal: AbortSignal) {
  const Command = rotationCommands[action];
  await sendKms(
    endpoint,
    ROTATION_OPERATIONS[action],
    async (client, abortSignal) => {
      await client.send(new Command({ KeyId: keyId }), { abortSignal });
    },
    signal,
  );
}
