import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

export function sendEvents<T>(
  endpoint: string,
  operation: string,
  send: (client: EventBridgeClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(EventBridgeClient, { endpoint }), abort), signal);
}

export function sendSqs<T>(
  endpoint: string,
  operation: string,
  send: (client: SQSClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(
    operation,
    (abort) => send(createAwsClient(SQSClient, { endpoint }, { useQueueUrlAsEndpoint: false }), abort),
    signal,
  );
}

export function sendSns<T>(
  endpoint: string,
  operation: string,
  send: (client: SNSClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(SNSClient, { endpoint }), abort), signal);
}
