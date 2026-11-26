import { CreateLogStreamCommand, DeleteLogStreamCommand } from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const CREATE_LOG_STREAM = 'CreateLogStream';
export const DELETE_LOG_STREAM = 'DeleteLogStream';

export async function createLogStream(
  endpoint: string,
  group: string,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  await sendLogs(
    endpoint,
    CREATE_LOG_STREAM,
    (client, abortSignal) =>
      client.send(new CreateLogStreamCommand({ logGroupName: group, logStreamName: name }), { abortSignal }),
    signal,
  );
}

export async function deleteLogStream(
  endpoint: string,
  group: string,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  await sendLogs(
    endpoint,
    DELETE_LOG_STREAM,
    (client, abortSignal) =>
      client.send(new DeleteLogStreamCommand({ logGroupName: group, logStreamName: name }), { abortSignal }),
    signal,
  );
}
