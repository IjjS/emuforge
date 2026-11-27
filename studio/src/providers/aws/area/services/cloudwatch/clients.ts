import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SNSClient } from '@aws-sdk/client-sns';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

export function sendCloudWatch<T>(
  endpoint: string,
  operation: string,
  send: (client: CloudWatchClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(CloudWatchClient, { endpoint }), abort), signal);
}

export function sendSns<T>(
  endpoint: string,
  operation: string,
  send: (client: SNSClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(SNSClient, { endpoint }), abort), signal);
}
