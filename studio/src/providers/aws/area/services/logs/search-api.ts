import { FilterLogEventsCommand, type FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';

import type { TokenPage } from '../../components/use-token-listing';
import { sendLogs } from '../../lib/cloudwatch-logs-client';
import type { SearchRequest } from './search-form';

export const FILTER_LOG_EVENTS = 'FilterLogEvents';

export async function filterLogEvents(
  endpoint: string,
  request: SearchRequest,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<FilteredLogEvent>> {
  const command = new FilterLogEventsCommand({ ...request, limit: 100, nextToken: token });
  const { events = [], nextToken } = await sendLogs(
    endpoint,
    FILTER_LOG_EVENTS,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return nextToken === undefined ? { items: events } : { items: events, next: nextToken };
}
