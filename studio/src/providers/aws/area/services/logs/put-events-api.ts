import { PutLogEventsCommand, type InputLogEvent } from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const PUT_LOG_EVENTS = 'PutLogEvents';

export async function putLogEvents(
  endpoint: string,
  group: string,
  stream: string,
  events: InputLogEvent[],
  signal: AbortSignal,
) {
  const command = new PutLogEventsCommand({ logGroupName: group, logStreamName: stream, logEvents: events });
  const { rejectedLogEventsInfo } = await sendLogs(
    endpoint,
    PUT_LOG_EVENTS,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return rejectedLogEventsInfo;
}
