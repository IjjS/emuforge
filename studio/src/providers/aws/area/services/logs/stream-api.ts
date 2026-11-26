import { DescribeLogStreamsCommand, type LogStream } from '@aws-sdk/client-cloudwatch-logs';

import type { TokenPage } from '../../components/use-token-listing';
import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const DESCRIBE_LOG_STREAMS = 'DescribeLogStreams';

export async function listLogStreams(
  endpoint: string,
  group: string,
  prefix: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<LogStream>> {
  const answer = await sendLogs(
    endpoint,
    DESCRIBE_LOG_STREAMS,
    (client, abortSignal) =>
      client.send(
        new DescribeLogStreamsCommand({
          logGroupName: group,
          limit: 25,
          nextToken: token,
          ...(prefix === '' ? { orderBy: 'LastEventTime', descending: true } : { logStreamNamePrefix: prefix }),
        }),
        { abortSignal },
      ),
    signal,
  );

  const items = answer.logStreams ?? [];
  return answer.nextToken === undefined ? { items } : { items, next: answer.nextToken };
}
