import { TagResourceCommand, UntagResourceCommand, UpdateEventBusCommand } from '@aws-sdk/client-eventbridge';

import type { tagChanges } from '../../components/tags';
import { sendEvents } from './clients';

export const BUS_SETTINGS_OPERATIONS = {
  update: 'UpdateEventBus',
  untag: 'UntagResource',
  tag: 'TagResource',
} as const;

export type TagWriteOperation = typeof BUS_SETTINGS_OPERATIONS.untag | typeof BUS_SETTINGS_OPERATIONS.tag;

export async function updateBusDescription(endpoint: string, name: string, description: string, signal: AbortSignal) {
  await sendEvents(
    endpoint,
    BUS_SETTINGS_OPERATIONS.update,
    (client, abortSignal) =>
      client.send(new UpdateEventBusCommand({ Name: name, Description: description }), { abortSignal }),
    signal,
  );
}

export class PartialTagSaveError extends Error {
  constructor(cause: unknown) {
    super('The removed tags were saved. The added and changed tags were not.', { cause });
  }
}

export async function saveBusTags(
  endpoint: string,
  arn: string,
  { remove, put }: ReturnType<typeof tagChanges>,
  signal: AbortSignal,
) {
  if (remove.length > 0) {
    await sendEvents(
      endpoint,
      BUS_SETTINGS_OPERATIONS.untag,
      (client, abortSignal) =>
        client.send(new UntagResourceCommand({ ResourceARN: arn, TagKeys: remove }), { abortSignal }),
      signal,
    );
  }

  const tags = Object.entries(put).map(([Key, Value]) => ({ Key, Value }));
  if (tags.length === 0) return;

  try {
    await sendEvents(
      endpoint,
      BUS_SETTINGS_OPERATIONS.tag,
      (client, abortSignal) => client.send(new TagResourceCommand({ ResourceARN: arn, Tags: tags }), { abortSignal }),
      signal,
    );
  } catch (error) {
    if (remove.length > 0) throw new PartialTagSaveError(error);
    throw error;
  }
}
