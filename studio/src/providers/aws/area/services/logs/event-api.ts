import { GetLogEventsCommand, type OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const GET_LOG_EVENTS = 'GetLogEvents';

export type EventRead =
  | { kind: 'newest' }
  | { kind: 'continue'; token: string }
  | { kind: 'from-time'; time: number }
  | { kind: 'before-time'; time: number };

export interface EventPage {
  events: OutputLogEvent[];
  nextBackwardToken?: string;
  nextForwardToken?: string;
}

export async function getLogEvents(
  endpoint: string,
  group: string,
  stream: string,
  read: EventRead,
  signal: AbortSignal,
): Promise<EventPage> {
  const input = new GetLogEventsCommand({
    logGroupName: group,
    logStreamName: stream,
    limit: 100,
    nextToken: read.kind === 'continue' ? read.token : undefined,
    startTime: read.kind === 'from-time' ? read.time : undefined,
    startFromHead: read.kind === 'from-time' ? true : undefined,
    endTime: read.kind === 'before-time' ? read.time : undefined,
  });
  const { events, nextBackwardToken, nextForwardToken } = await sendLogs(
    endpoint,
    GET_LOG_EVENTS,
    (client, abortSignal) => client.send(input, { abortSignal }),
    signal,
  );
  return {
    events: events ?? [],
    nextBackwardToken,
    nextForwardToken,
  };
}
