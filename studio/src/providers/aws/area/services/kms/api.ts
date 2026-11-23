import {
  DescribeKeyCommand,
  KMSClient,
  ListAliasesCommand,
  ListKeysCommand,
  type KeyMetadata,
} from '@aws-sdk/client-kms';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';

export const KMS_OPERATIONS = {
  listKeys: 'ListKeys',
  describeKey: 'DescribeKey',
  listAliases: 'ListAliases',
} as const;

export const KEY_PAGE_SIZE = 20;

export interface CustomerKey {
  id: string;
  aliases: string[];
  state: string | undefined;
  description: string | undefined;
}

const clients = new Map<string, KMSClient>();

function kmsClient(endpoint: string): KMSClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(KMSClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export function sendKms<T>(
  endpoint: string,
  operation: string,
  send: (client: KMSClient, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => send(kmsClient(endpoint), abortSignal), signal);
}

/** Return null when KMS reports that the key no longer exists. */
export async function describeKey(endpoint: string, keyId: string, signal: AbortSignal): Promise<KeyMetadata | null> {
  const operation = KMS_OPERATIONS.describeKey;
  const answer = await sendKms(
    endpoint,
    operation,
    (client, abortSignal) => client.send(new DescribeKeyCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  ).catch((error: unknown) => {
    if (error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === 'NotFoundException') {
      return null;
    }
    throw error;
  });

  if (answer === null) return null;
  if (!answer.KeyMetadata?.KeyId) {
    throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  }
  return answer.KeyMetadata;
}

export async function listKeyAliases(
  endpoint: string,
  keyId: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<string>> {
  const answer = await sendKms(
    endpoint,
    KMS_OPERATIONS.listAliases,
    (client, abortSignal) => client.send(new ListAliasesCommand({ KeyId: keyId, Marker: marker }), { abortSignal }),
    signal,
  );
  const items = (answer.Aliases ?? []).flatMap(({ AliasName, TargetKeyId }) =>
    TargetKeyId === keyId && AliasName ? [AliasName] : [],
  );
  return answer.Truncated && answer.NextMarker ? { items, next: answer.NextMarker } : { items };
}

export async function listCustomerKeys(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<CustomerKey>> {
  const answer = await sendKms(
    endpoint,
    KMS_OPERATIONS.listKeys,
    (client, abortSignal) =>
      client.send(new ListKeysCommand({ Limit: KEY_PAGE_SIZE, Marker: marker }), { abortSignal }),
    signal,
  );
  const listed = await Promise.all(
    (answer.Keys ?? []).map(async ({ KeyId }) => {
      if (!KeyId) return undefined;

      const key = await describeKey(endpoint, KeyId, signal);
      if (key?.KeyManager !== 'CUSTOMER') return undefined;

      const aliases = await listKeyAliases(endpoint, key.KeyId, undefined, signal);
      return { id: key.KeyId, aliases: aliases.items, state: key.KeyState, description: key.Description };
    }),
  );

  const items = listed.filter((key) => key !== undefined);
  return answer.Truncated && answer.NextMarker ? { items, next: answer.NextMarker } : { items };
}
