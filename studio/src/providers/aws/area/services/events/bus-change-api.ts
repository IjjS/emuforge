import {
  CreateEventBusCommand,
  DeleteEventBusCommand,
  type CreateEventBusCommandInput,
} from '@aws-sdk/client-eventbridge';

import { sendEvents } from './clients';

export const BUS_CHANGE_OPERATIONS = { create: 'CreateEventBus', delete: 'DeleteEventBus' } as const;

export const DEFAULT_BUS_DELETE_REASON = 'The default event bus cannot be deleted.';
export const BUS_DELETE_UNAVAILABLE = 'Not implemented by the emulator (DeleteEventBus).';

export async function createEventBus(
  endpoint: string,
  input: CreateEventBusCommandInput,
  signal: AbortSignal,
): Promise<void> {
  await sendEvents(
    endpoint,
    BUS_CHANGE_OPERATIONS.create,
    (client, abortSignal) => client.send(new CreateEventBusCommand(input), { abortSignal }),
    signal,
  );
}

export async function deleteEventBus(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendEvents(
    endpoint,
    BUS_CHANGE_OPERATIONS.delete,
    (client, abortSignal) => client.send(new DeleteEventBusCommand({ Name: name }), { abortSignal }),
    signal,
  );
}
