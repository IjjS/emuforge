import { DescribeKeyCommand, KMSClient, ListAliasesCommand, ListKeysCommand } from '@aws-sdk/client-kms';

import { createAwsClient } from '../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../lib/aws/request';
import { text, withValues } from '../lib/ec2-client';
import type { ChoiceSource } from './use-paged-choices';

export interface KmsKeyChoice {
  id: string;
  arn: string;
  aliases: readonly string[];
  usage?: string;
  spec?: string;
  description?: string;
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

async function listAliases(client: KMSClient, signal: AbortSignal): Promise<Map<string, string[]>> {
  const aliases = new Map<string, string[]>();
  let marker: string | undefined;
  do {
    const input = marker === undefined ? {} : { Marker: marker };
    const page = await sendRequest(
      'ListAliases',
      (abortSignal) => client.send(new ListAliasesCommand(input), { abortSignal }),
      signal,
    );
    for (const alias of page.Aliases ?? []) {
      const id = text(alias.TargetKeyId);
      const name = text(alias.AliasName);
      if (id === undefined || name === undefined) continue;
      const names = aliases.get(id);
      if (names === undefined) {
        aliases.set(id, [name]);
      } else {
        names.push(name);
      }
    }
    marker = text(page.NextMarker);
  } while (marker !== undefined);
  return aliases;
}

async function describeKey(
  client: KMSClient,
  keyId: string,
  aliases: readonly string[],
  signal: AbortSignal,
): Promise<KmsKeyChoice | undefined> {
  const result = await sendRequest(
    'DescribeKey',
    (abortSignal) => client.send(new DescribeKeyCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
  const metadata = result.KeyMetadata;
  const arn = text(metadata?.Arn);
  if (metadata?.KeyState !== 'Enabled' || arn === undefined) return undefined;

  return withValues<KmsKeyChoice>(
    { id: keyId, arn, aliases },
    { usage: text(metadata.KeyUsage), spec: text(metadata.KeySpec), description: text(metadata.Description) },
  );
}

type KeyPage = Awaited<ReturnType<ChoiceSource<KmsKeyChoice>['read']>>;

async function listKeys(
  client: KMSClient,
  aliases: Map<string, string[]>,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<KeyPage> {
  const items: KmsKeyChoice[] = [];
  do {
    const input = marker === undefined ? {} : { Marker: marker };
    const page = await sendRequest(
      'ListKeys',
      (abortSignal) => client.send(new ListKeysCommand(input), { abortSignal }),
      signal,
    );
    for (const key of page.Keys ?? []) {
      const id = text(key.KeyId);
      if (id === undefined) continue;
      const choice = await describeKey(client, id, aliases.get(id) ?? [], signal);
      if (choice !== undefined) items.push(choice);
    }
    marker = text(page.NextMarker);
  } while (items.length === 0 && marker !== undefined);

  const next = marker;
  return next === undefined
    ? { items }
    : {
        items,
        next,
        readNext: (nextSignal) => listKeys(client, aliases, next, nextSignal),
      };
}

/** Enabled KMS keys with their aliases, read again from the emulator on each opening. */
export function kmsKeyChoices(endpoint: string | undefined): ChoiceSource<KmsKeyChoice> {
  return {
    key: ['aws', 'area', 'kms-key-choices'],
    endpoint,
    operation: 'ListKeys',
    readAgainOnOpen: true,
    read: async (at, _text, token, signal) => {
      const client = kmsClient(at);
      return listKeys(client, await listAliases(client, signal), token, signal);
    },
    optionOf: (key) => {
      const description = [...key.aliases, key.usage, key.spec, key.description].filter(Boolean).join(' · ');
      return {
        value: key.arn,
        label: key.aliases[0] ?? key.id,
        ...(description === '' ? {} : { description }),
        tags: [key.id],
      };
    },
  };
}
