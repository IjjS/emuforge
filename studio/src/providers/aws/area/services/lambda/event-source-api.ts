import {
  CreateEventSourceMappingCommand,
  DeleteEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  UpdateEventSourceMappingCommand,
  type CreateEventSourceMappingCommandInput,
} from '@aws-sdk/client-lambda';

import { RequestError, sendRequest, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import { lambdaClient } from './api';

export const LIST_EVENT_SOURCES = 'ListEventSourceMappings';

export interface EventSourceMapping {
  uuid: string;
  sourceArn: string | undefined;
  state: string | undefined;
  lastProcessingResult: string | undefined;
}

export async function listEventSources(
  endpoint: string,
  name: string,
  signal: AbortSignal,
): Promise<EventSourceMapping[]> {
  const client = lambdaClient(endpoint);
  const items: EventSourceMapping[] = [];
  const markers = new Set<string>();
  let marker: string | undefined;
  do {
    const command = new ListEventSourceMappingsCommand({ FunctionName: name, Marker: marker });
    const answer = await sendRequest(
      LIST_EVENT_SOURCES,
      (abortSignal) => client.send(command, { abortSignal }),
      signal,
    );
    for (const { UUID, EventSourceArn, State, LastProcessingResult } of answer.EventSourceMappings ?? []) {
      if (!UUID) {
        throw new RequestError({
          kind: 'other',
          operation: LIST_EVENT_SOURCES,
          code: UNREADABLE_ANSWER,
          message: 'An event source mapping has no UUID.',
        });
      }
      items.push({ uuid: UUID, sourceArn: EventSourceArn, state: State, lastProcessingResult: LastProcessingResult });
    }
    marker = answer.NextMarker;
    if (marker) {
      if (markers.has(marker)) {
        throw new RequestError({
          kind: 'other',
          operation: LIST_EVENT_SOURCES,
          code: UNREADABLE_ANSWER,
          message: 'A page marker repeated.',
        });
      }
      markers.add(marker);
    }
  } while (marker);
  return items;
}

export type EventSourceChange =
  | { operation: 'CreateEventSourceMapping'; sourceArn: string; startingPosition?: 'LATEST' }
  | { operation: 'UpdateEventSourceMapping'; mapping: EventSourceMapping; enabled: boolean }
  | { operation: 'DeleteEventSourceMapping'; mapping: EventSourceMapping };

export async function changeEventSource(
  endpoint: string,
  name: string,
  change: EventSourceChange,
  signal: AbortSignal,
): Promise<void> {
  const client = lambdaClient(endpoint);
  const { operation } = change;
  switch (operation) {
    case 'CreateEventSourceMapping': {
      const input: CreateEventSourceMappingCommandInput = { FunctionName: name, EventSourceArn: change.sourceArn };
      if (change.startingPosition !== undefined) {
        input.StartingPosition = change.startingPosition;
      }
      await sendRequest(
        operation,
        (abortSignal) => client.send(new CreateEventSourceMappingCommand(input), { abortSignal }),
        signal,
      );
      break;
    }
    case 'UpdateEventSourceMapping': {
      const command = new UpdateEventSourceMappingCommand({ UUID: change.mapping.uuid, Enabled: change.enabled });
      await sendRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
      break;
    }
    case 'DeleteEventSourceMapping': {
      const command = new DeleteEventSourceMappingCommand({ UUID: change.mapping.uuid });
      await sendRequest(operation, (abortSignal) => client.send(command, { abortSignal }), signal);
      break;
    }
  }
}
