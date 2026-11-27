import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ListTopicsCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetQueueAttributesCommand, ListQueuesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { expect, it, vi } from 'vitest';

import { getTargetQueueArn, listTargetLogGroups, listTargetQueues, listTargetTopics } from './target-sources';

const endpoint = 'http://127.0.0.1:8327';
const signal = new AbortController().signal;
const url = 'https://127.0.0.1:9327/000000000000/work.fifo';

it('reads queues by token and describes each option by its URL', async () => {
  const send = vi
    .spyOn(SQSClient.prototype, 'send')
    .mockResolvedValueOnce({ QueueUrls: [url], NextToken: 'further' } as never);
  await expect(listTargetQueues(endpoint, 'next', signal)).resolves.toEqual({
    items: [{ label: 'work.fifo', value: url, description: url }],
    next: 'further',
  });
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(ListQueuesCommand);
  expect(command).toMatchObject({ input: { MaxResults: 25, NextToken: 'next' } });
  send.mockRestore();
});

it('asks for the chosen queue ARN and returns the emulator value', async () => {
  const send = vi
    .spyOn(SQSClient.prototype, 'send')
    .mockResolvedValueOnce({ Attributes: { QueueArn: 'arn:queue' } } as never);
  await expect(getTargetQueueArn(endpoint, url, signal)).resolves.toBe('arn:queue');
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(GetQueueAttributesCommand);
  expect(command).toMatchObject({ input: { QueueUrl: url, AttributeNames: ['QueueArn'] } });
  send.mockRestore();
});

it('reads topic options by token using the ARN for value and description', async () => {
  const arn = 'arn:aws:sns:us-east-1:000000000000:orders';
  const send = vi
    .spyOn(SNSClient.prototype, 'send')
    .mockResolvedValueOnce({ Topics: [{ TopicArn: arn }], NextToken: 'further' } as never);
  await expect(listTargetTopics(endpoint, 'next', signal)).resolves.toEqual({
    items: [{ label: 'orders', value: arn, description: arn }],
    next: 'further',
  });
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(ListTopicsCommand);
  expect(command).toMatchObject({ input: { NextToken: 'next' } });
  send.mockRestore();
});

it('reads log group options by token using logGroupArn as returned', async () => {
  const arn = 'arn:aws:logs:us-east-1:000000000000:log-group:/local/orders';
  const send = vi.spyOn(CloudWatchLogsClient.prototype, 'send').mockResolvedValueOnce({
    logGroups: [{ logGroupName: '/local/orders', arn: `${arn}:*`, logGroupArn: arn }],
    nextToken: 'further',
  } as never);
  await expect(listTargetLogGroups(endpoint, 'next', signal)).resolves.toEqual({
    items: [{ label: '/local/orders', value: arn, description: arn }],
    next: 'further',
  });
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(DescribeLogGroupsCommand);
  expect(command).toMatchObject({ input: { limit: 25, nextToken: 'next' } });
  send.mockRestore();
});
