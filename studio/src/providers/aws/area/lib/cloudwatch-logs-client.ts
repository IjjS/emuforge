import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';

import { createAwsClient } from '../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../lib/aws/request';

const clients = new Map<string, CloudWatchLogsClient>();

function logsClient(endpoint: string): CloudWatchLogsClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(CloudWatchLogsClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

/** One CloudWatch Logs request through the engine at the given endpoint. */
export function sendLogs<T>(
  endpoint: string,
  operation: string,
  send: (client: CloudWatchLogsClient, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => send(logsClient(endpoint), abortSignal), signal);
}
