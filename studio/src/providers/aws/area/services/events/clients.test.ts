import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { expect, it, vi } from 'vitest';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendEvents, sendSns, sendSqs } from './clients';

vi.mock('../../../../../lib/aws/client-factory', () => ({ createAwsClient: vi.fn() }));

const endpoint = 'http://127.0.0.1:8306';

it.each([
  [sendEvents, EventBridgeClient, 'ListEventBuses', []],
  [sendSqs, SQSClient, 'ListQueues', [{ useQueueUrlAsEndpoint: false }]],
  [sendSns, SNSClient, 'ListTopics', []],
] as const)('sends through its engine client and aborts %s', async (send, clientClass, operation, options) => {
  const client = Object.create(clientClass.prototype) as EventBridgeClient & SQSClient & SNSClient;
  vi.mocked(createAwsClient).mockReturnValue(client);
  const controller = new AbortController();
  const call = vi.fn(() => new Promise<never>(() => undefined));
  const pending = send(endpoint, operation, call, controller.signal);
  expect(createAwsClient).toHaveBeenLastCalledWith(clientClass, { endpoint }, ...options);
  expect(call).toHaveBeenCalledExactlyOnceWith(client, controller.signal);
  const reason = new Error('Page left');
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);

  await expect(
    send(
      endpoint,
      operation,
      async () => {
        throw { $metadata: { httpStatusCode: 501 } };
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ failure: { kind: 'not-implemented', operation } });
});
