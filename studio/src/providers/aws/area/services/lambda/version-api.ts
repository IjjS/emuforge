import {
  CreateAliasCommand,
  DeleteAliasCommand,
  ListAliasesCommand,
  ListVersionsByFunctionCommand,
  PublishVersionCommand,
  UpdateAliasCommand,
  type AliasConfiguration,
} from '@aws-sdk/client-lambda';

import { RequestError, sendRequest, UNREADABLE_ANSWER, type RequestFailure } from '../../../../../lib/aws/request';
import { lambdaClient } from './api';

export type ReleaseFailure = RequestFailure & { reportedCode?: string };

export class ReleaseRequestError extends RequestError {
  constructor(
    failure: RequestFailure,
    readonly reportedCode: string,
  ) {
    super(failure);
  }
}

/** Keep the SDK code for the failure kinds whose shared mapping keeps only the message. */
async function sendReleaseRequest<T>(
  operation: string,
  send: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let source: { Code?: unknown; name?: unknown } | undefined;
  try {
    return await sendRequest(
      operation,
      async (abortSignal) => {
        try {
          return await send(abortSignal);
        } catch (error) {
          if (typeof error === 'object' && error !== null) {
            source = error;
          }
          throw error;
        }
      },
      signal,
    );
  } catch (error) {
    if (
      error instanceof RequestError &&
      (error.failure.kind === 'access-denied' || error.failure.kind === 'emulator-did-not-answer')
    ) {
      const code = source?.Code || source?.name;
      if (typeof code === 'string' && code !== '') {
        throw new ReleaseRequestError(error.failure, code);
      }
    }
    throw error;
  }
}

export const LIST_VERSIONS = 'ListVersionsByFunction';
export const LIST_ALIASES = 'ListAliases';

export interface FunctionVersion {
  version: string;
  description?: string | undefined;
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
    const answer = await sendReleaseRequest(
      LIST_VERSIONS,
      (abortSignal) => client.send(command, { abortSignal }),
      signal,
    );
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
    const answer = await sendReleaseRequest(
      LIST_ALIASES,
      (abortSignal) => client.send(command, { abortSignal }),
      signal,
    );
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
    const answer = await sendReleaseRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
    if (!answer.Version) {
      throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
    }
    return { operation, version: answer.Version };
  }
  if (operation === 'DeleteAlias') {
    const command = new DeleteAliasCommand({ FunctionName: name, Name: change.name });
    await sendReleaseRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
    return { operation, name: change.name };
  }
  const input = { FunctionName: name, Name: change.alias.name, FunctionVersion: change.alias.version };
  const answer = await sendReleaseRequest<AliasConfiguration>(
    operation,
    (abortSignal) =>
      operation === 'CreateAlias'
        ? client.send(new CreateAliasCommand(input), { abortSignal })
        : client.send(new UpdateAliasCommand(input), { abortSignal }),
    signal,
  );
  const [alias] = aliasOf(answer);
  if (alias === undefined) {
    throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  }
  return { operation, alias };
}
