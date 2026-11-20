import {
  CreateKeyPairCommand,
  DeleteKeyPairCommand,
  DescribeKeyPairsCommand,
  ImportKeyPairCommand,
  type KeyPairInfo,
} from '@aws-sdk/client-ec2';

import { sendEc2, text } from './api';

// The calls of EC2's key pair screens, S8 and S9 (issue 553, design task 5), through the engine as every API file of
// the folder sends them (`api.ts`, `sendEc2`), mapped to plain typed results. `DescribeKeyPairs` has no pages: one
// answer holds every key pair. The private key of a create is in that one answer only; it is handed to the caller and
// kept nowhere here.

/** The operations of the key pair screens, as a failure names them. */
export const KEY_PAIR_OPERATIONS = {
  describeKeyPairs: 'DescribeKeyPairs',
  createKeyPair: 'CreateKeyPair',
  importKeyPair: 'ImportKeyPair',
  deleteKeyPair: 'DeleteKeyPair',
} as const;

/** A key pair's type, as the API names it. */
export type KeyType = 'rsa' | 'ed25519';

/** A private key's format, as the API names it. */
export type KeyFormat = 'pem' | 'ppk';

/** A key pair as S8 shows it. A value the answer lacks is absent. */
export interface KeyPair {
  name: string;
  id?: string;
  type?: string;
  fingerprint?: string;
  createdAt?: Date;
}

function keyPairOf(raw: KeyPairInfo): KeyPair | undefined {
  const name = text(raw.KeyName);
  if (name === undefined) {
    return undefined;
  }
  const keyPair: KeyPair = { name };
  const id = text(raw.KeyPairId);
  if (id !== undefined) {
    keyPair.id = id;
  }
  const type = text(raw.KeyType);
  if (type !== undefined) {
    keyPair.type = type;
  }
  const fingerprint = text(raw.KeyFingerprint);
  if (fingerprint !== undefined) {
    keyPair.fingerprint = fingerprint;
  }
  if (raw.CreateTime instanceof Date && !Number.isNaN(raw.CreateTime.getTime())) {
    keyPair.createdAt = raw.CreateTime;
  }
  return keyPair;
}

/** S8's read: one `DescribeKeyPairs`, every key pair in the answer's order. */
export async function listKeyPairs(endpoint: string, signal: AbortSignal): Promise<KeyPair[]> {
  const output = await sendEc2(
    endpoint,
    KEY_PAIR_OPERATIONS.describeKeyPairs,
    (client, abortSignal) => client.send(new DescribeKeyPairsCommand({}), { abortSignal }),
    signal,
  );
  return (output.KeyPairs ?? []).flatMap((raw) => {
    const keyPair = keyPairOf(raw);
    return keyPair === undefined ? [] : [keyPair];
  });
}

/** What S9 creates. */
export interface NewKeyPair {
  name: string;
  type: KeyType;
  format: KeyFormat;
}

/** The answer of a create: the private key, exactly as it came, with the key pair's fingerprint and ID. */
export interface CreatedKeyPair {
  name: string;
  privateKey: string;
  fingerprint?: string;
  id?: string;
}

/** `CreateKeyPair` with `KeyName`, `KeyType` and `KeyFormat`. */
export async function createKeyPair(
  endpoint: string,
  keyPair: NewKeyPair,
  signal: AbortSignal,
): Promise<CreatedKeyPair> {
  const output = await sendEc2(
    endpoint,
    KEY_PAIR_OPERATIONS.createKeyPair,
    (client, abortSignal) =>
      client.send(
        new CreateKeyPairCommand({ KeyName: keyPair.name, KeyType: keyPair.type, KeyFormat: keyPair.format }),
        { abortSignal },
      ),
    signal,
  );
  const created: CreatedKeyPair = { name: text(output.KeyName) ?? keyPair.name, privateKey: output.KeyMaterial ?? '' };
  const fingerprint = text(output.KeyFingerprint);
  if (fingerprint !== undefined) {
    created.fingerprint = fingerprint;
  }
  const id = text(output.KeyPairId);
  if (id !== undefined) {
    created.id = id;
  }
  return created;
}

/** `ImportKeyPair` with `KeyName` and `PublicKeyMaterial`, the bytes of the text as it was given. */
export async function importKeyPair(
  endpoint: string,
  name: string,
  publicKey: string,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    KEY_PAIR_OPERATIONS.importKeyPair,
    (client, abortSignal) =>
      client.send(
        new ImportKeyPairCommand({ KeyName: name, PublicKeyMaterial: new TextEncoder().encode(publicKey) }),
        { abortSignal },
      ),
    signal,
  );
}

/** `DeleteKeyPair` by `KeyName`. */
export async function deleteKeyPair(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    KEY_PAIR_OPERATIONS.deleteKeyPair,
    (client, abortSignal) => client.send(new DeleteKeyPairCommand({ KeyName: name }), { abortSignal }),
    signal,
  );
}
