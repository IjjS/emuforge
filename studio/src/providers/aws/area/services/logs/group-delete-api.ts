import { DeleteLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const DELETE_LOG_GROUP = 'DeleteLogGroup';

export async function deleteLogGroup(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendLogs(
    endpoint,
    DELETE_LOG_GROUP,
    (client, abortSignal) => client.send(new DeleteLogGroupCommand({ logGroupName: name }), { abortSignal }),
    signal,
  );
}
