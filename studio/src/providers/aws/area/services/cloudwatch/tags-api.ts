import { TagResourceCommand, UntagResourceCommand } from '@aws-sdk/client-cloudwatch';

import { sendCloudWatch } from './clients';
import type { TagChanges } from './tags';

export const UNTAG_RESOURCE = 'UntagResource';
export const TAG_RESOURCE = 'TagResource';
export type TagOperation = typeof UNTAG_RESOURCE | typeof TAG_RESOURCE;

export class SaveAlarmTagsError extends Error {
  constructor(
    readonly operation: TagOperation,
    readonly removalsSaved: boolean,
    cause: unknown,
  ) {
    super(`${operation} failed`, { cause });
    this.name = 'SaveAlarmTagsError';
  }
}

export async function saveAlarmTags(
  endpoint: string,
  arn: string,
  { remove, put }: TagChanges,
  signal: AbortSignal,
): Promise<void> {
  if (remove.length > 0) {
    try {
      const command = new UntagResourceCommand({ ResourceARN: arn, TagKeys: remove });
      await sendCloudWatch(
        endpoint,
        UNTAG_RESOURCE,
        (client, abort) => client.send(command, { abortSignal: abort }),
        signal,
      );
    } catch (error) {
      throw new SaveAlarmTagsError(UNTAG_RESOURCE, false, error);
    }
  }
  if (put.length > 0) {
    try {
      const command = new TagResourceCommand({
        ResourceARN: arn,
        Tags: put.map(({ key, value }) => ({ Key: key, Value: value })),
      });
      await sendCloudWatch(
        endpoint,
        TAG_RESOURCE,
        (client, abort) => client.send(command, { abortSignal: abort }),
        signal,
      );
    } catch (error) {
      throw new SaveAlarmTagsError(TAG_RESOURCE, remove.length > 0, error);
    }
  }
}
