import {
  CreateAliasCommand,
  DeleteAliasCommand,
  ListAliasesCommand,
  ListVersionsByFunctionCommand,
  PublishVersionCommand,
  UpdateAliasCommand,
  type AliasConfiguration,
} from '@aws-sdk/client-lambda';

import { RequestError, sendRequest, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import { lambdaClient } from './api';

export const LIST_VERSIONS = 'ListVersionsByFunction';
export const LIST_ALIASES = 'ListAliases';

export interface FunctionVersion {
  version: string;
  description?: string;
}

export interface FunctionAlias {
  name: string;
  version: string;
}

interface ReleasePage<T> {
  items: T[];
  nextMarker: string | undefined;
}

function aliasOf(item: AliasConfiguration): FunctionAlias[] {
  return item.Name && item.FunctionVersion ? [{ name: item.Name, version: item.FunctionVersion }] : [];
}

async function readAll<T>(operation: string, read: (marker?: string) => Promise<ReleasePage<T>>): Promise<T[]> {
  const items: T[] = [];
  const markers = new Set<string>();
  let marker: string | undefined;
  do {
    const page = await read(marker);
    items.push(...page.items);
    marker = page.nextMarker;
    if (marker) {
      if (markers.has(marker)) {
        throw new RequestError({
          kind: 'other',
          operation,
          code: UNREADABLE_ANSWER,
          message: 'A page marker repeated.',
        });
      }
      markers.add(marker);
    }
  } while (marker);
  return items;
}

export function listVersions(endpoint: string, name: string, signal: AbortSignal): Promise<FunctionVersion[]> {
  const client = lambdaClient(endpoint);
  return readAll(LIST_VERSIONS, async (marker) => {
    const command = new ListVersionsByFunctionCommand({ FunctionName: name, Marker: marker });
    const answer = await sendRequest(LIST_VERSIONS, (abortSignal) => client.send(command, { abortSignal }), signal);
    return {
      items: (answer.Versions ?? []).flatMap(({ Version, Description }) =>
        Version ? [{ version: Version, description: Description }] : [],
      ),
      nextMarker: answer.NextMarker,
    };
  });
}

export function listAliases(endpoint: string, name: string, signal: AbortSignal): Promise<FunctionAlias[]> {
  const client = lambdaClient(endpoint);
  return readAll(LIST_ALIASES, async (marker) => {
    const command = new ListAliasesCommand({ FunctionName: name, Marker: marker });
    const answer = await sendRequest(LIST_ALIASES, (abortSignal) => client.send(command, { abortSignal }), signal);
    return { items: (answer.Aliases ?? []).flatMap(aliasOf), nextMarker: answer.NextMarker };
  });
}

export type ReleaseChange =
  | { operation: 'PublishVersion' }
  | { operation: 'CreateAlias' | 'UpdateAlias'; alias: FunctionAlias }
  | { operation: 'DeleteAlias'; name: string };

export type ReleaseResult =
  | { operation: 'PublishVersion'; version: string }
  | { operation: 'CreateAlias' | 'UpdateAlias'; alias: FunctionAlias }
  | { operation: 'DeleteAlias'; name: string };

export async function changeRelease(
  endpoint: string,
  name: string,
  change: ReleaseChange,
  signal: AbortSignal,
): Promise<ReleaseResult> {
  const client = lambdaClient(endpoint);
  const { operation } = change;
  if (operation === 'PublishVersion') {
    const command = new PublishVersionCommand({ FunctionName: name });
    const answer = await sendRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
    if (!answer.Version) {
      throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
    }
    return { operation, version: answer.Version };
  }
  if (operation === 'DeleteAlias') {
    const command = new DeleteAliasCommand({ FunctionName: name, Name: change.name });
    await sendRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
    return { operation, name: change.name };
  }
  const input = { FunctionName: name, Name: change.alias.name, FunctionVersion: change.alias.version };
  const command = operation === 'CreateAlias' ? new CreateAliasCommand(input) : new UpdateAliasCommand(input);
  const answer = await sendRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
  const [alias] = aliasOf(answer);
  if (alias === undefined) {
    throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  }
  return { operation, alias };
}
