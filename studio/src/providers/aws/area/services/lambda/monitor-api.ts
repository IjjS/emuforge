import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { FilterLogEventsCommand, type FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { requestFailure, sendRequest } from '../../../../../lib/aws/request';
import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const FILTER_LOG_EVENTS = 'FilterLogEvents';
export const GET_METRIC_STATISTICS = 'GetMetricStatistics';
export const LOG_PAGE_SIZE = 25;

export type FunctionMetric = 'Invocations' | 'Errors';

interface MetricWindow {
  start: Date;
  end: Date;
}

type LogPage = { kind: 'events'; events: FilteredLogEvent[]; next: string | undefined } | { kind: 'missing-group' };

const clients = new Map<string, CloudWatchClient>();

function metricsClient(endpoint: string): CloudWatchClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(CloudWatchClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export function defaultLogGroup(name: string): string {
  return `/aws/lambda/${name}`;
}

export async function readLogPage(
  endpoint: string,
  group: string,
  nextToken: string | undefined,
  signal: AbortSignal,
): Promise<LogPage> {
  try {
    const result = await sendLogs(
      endpoint,
      FILTER_LOG_EVENTS,
      (client, abortSignal) =>
        client.send(new FilterLogEventsCommand({ logGroupName: group, limit: LOG_PAGE_SIZE, nextToken }), {
          abortSignal,
        }),
      signal,
    );
    return { kind: 'events', events: result.events ?? [], next: result.nextToken || undefined };
  } catch (error) {
    signal.throwIfAborted();
    const failure = requestFailure(FILTER_LOG_EVENTS, error);
    if (nextToken === undefined && failure.kind === 'other' && failure.code === 'ResourceNotFoundException') {
      return { kind: 'missing-group' };
    }
    throw error;
  }
}

export async function readMetricTotal(
  endpoint: string,
  name: string,
  metric: FunctionMetric,
  { start, end }: MetricWindow,
  signal: AbortSignal,
): Promise<number | null> {
  const command = new GetMetricStatisticsCommand({
    Namespace: 'AWS/Lambda',
    MetricName: metric,
    Dimensions: [{ Name: 'FunctionName', Value: name }],
    StartTime: start,
    EndTime: end,
    Period: 60,
    Statistics: ['Sum'],
  });
  const result = await sendRequest(
    GET_METRIC_STATISTICS,
    (abortSignal) => metricsClient(endpoint).send(command, { abortSignal }),
    signal,
  );
  let total: number | null = null;
  for (const { Sum } of result.Datapoints ?? []) {
    if (Sum !== undefined) {
      total = (total ?? 0) + Sum;
    }
  }
  return total;
}
