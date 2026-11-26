import {
  DeleteRetentionPolicyCommand,
  PutLogGroupDeletionProtectionCommand,
  TagLogGroupCommand,
  UntagLogGroupCommand,
} from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';
import type { tagChanges } from './tags';

export const GROUP_SETTINGS_OPERATIONS = {
  deleteRetentionPolicy: 'DeleteRetentionPolicy',
  putDeletionProtection: 'PutLogGroupDeletionProtection',
  untag: 'UntagLogGroup',
  tag: 'TagLogGroup',
} as const;

export function deleteRetentionPolicy(endpoint: string, name: string, signal: AbortSignal) {
  return sendLogs(
    endpoint,
    GROUP_SETTINGS_OPERATIONS.deleteRetentionPolicy,
    (client, abortSignal) => client.send(new DeleteRetentionPolicyCommand({ logGroupName: name }), { abortSignal }),
    signal,
  );
}

export function putLogGroupDeletionProtection(endpoint: string, name: string, enabled: boolean, signal: AbortSignal) {
  return sendLogs(
    endpoint,
    GROUP_SETTINGS_OPERATIONS.putDeletionProtection,
    (client, abortSignal) =>
      client.send(
        new PutLogGroupDeletionProtectionCommand({ logGroupIdentifier: name, deletionProtectionEnabled: enabled }),
        { abortSignal },
      ),
    signal,
  );
}

/** The removals were applied before the tag write failed. */
export class PartialTagSaveError extends Error {
  constructor(cause: unknown) {
    super('The tags removed in this save are already removed.', { cause });
  }
}

export async function saveLogGroupTags(
  endpoint: string,
  name: string,
  { remove, put }: ReturnType<typeof tagChanges>,
  signal: AbortSignal,
) {
  if (remove.length > 0) {
    await sendLogs(
      endpoint,
      GROUP_SETTINGS_OPERATIONS.untag,
      (client, abortSignal) =>
        client.send(new UntagLogGroupCommand({ logGroupName: name, tags: remove }), { abortSignal }),
      signal,
    );
  }
  if (Object.keys(put).length === 0) return;
  try {
    await sendLogs(
      endpoint,
      GROUP_SETTINGS_OPERATIONS.tag,
      (client, abortSignal) => client.send(new TagLogGroupCommand({ logGroupName: name, tags: put }), { abortSignal }),
      signal,
    );
  } catch (error) {
    if (remove.length > 0) throw new PartialTagSaveError(error);
    throw error;
  }
}
