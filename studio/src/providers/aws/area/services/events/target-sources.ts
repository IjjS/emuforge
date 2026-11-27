import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ListTopicsCommand } from '@aws-sdk/client-sns';
import { GetQueueAttributesCommand, ListQueuesCommand } from '@aws-sdk/client-sqs';

import { RequestError } from '../../../../../lib/aws/request';
import type { ChoiceSource } from '../../components/use-paged-choices';
import type { TokenPage } from '../../components/use-token-listing';
import { sendLogs } from '../../lib/cloudwatch-logs-client';
import { sendSns, sendSqs } from './clients';
import type { TargetKind, TargetResource } from './target-form';

export const TARGET_READS = {
  sqs: 'ListQueues',
  sns: 'ListTopics',
  logs: 'DescribeLogGroups',
  queueArn: 'GetQueueAttributes',
} as const;

function page(items: TargetResource[], next: string | undefined): TokenPage<TargetResource> {
  return next === undefined ? { items } : { items, next };
}

export function listTargetQueues(endpoint: string, token: string | undefined, signal: AbortSignal) {
  return sendSqs(
    endpoint,
    TARGET_READS.sqs,
    async (client, abortSignal) => {
      const { QueueUrls, NextToken } = await client.send(new ListQueuesCommand({ MaxResults: 25, NextToken: token }), {
        abortSignal,
      });
      return page(
        (QueueUrls ?? []).map((url) => ({ value: url, label: url.split('/').at(-1) || url, description: url })),
        NextToken,
      );
    },
    signal,
  );
}

export function getTargetQueueArn(endpoint: string, url: string, signal: AbortSignal) {
  return sendSqs(
    endpoint,
    TARGET_READS.queueArn,
    async (client, abortSignal) => {
      const { Attributes } = await client.send(
        new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }),
        { abortSignal },
      );
      if (!Attributes?.QueueArn) {
        throw new RequestError({
          kind: 'other',
          operation: TARGET_READS.queueArn,
          code: 'Missing queue ARN',
          message: 'The emulator did not return a queue ARN.',
        });
      }
      return Attributes.QueueArn;
    },
    signal,
  );
}

export function listTargetTopics(endpoint: string, token: string | undefined, signal: AbortSignal) {
  return sendSns(
    endpoint,
    TARGET_READS.sns,
    async (client, abortSignal) => {
      const { Topics, NextToken } = await client.send(new ListTopicsCommand({ NextToken: token }), { abortSignal });
      return page(
        (Topics ?? []).flatMap(({ TopicArn: arn }) =>
          arn ? [{ value: arn, label: arn.split(':').at(-1) || arn, description: arn }] : [],
        ),
        NextToken,
      );
    },
    signal,
  );
}

export function listTargetLogGroups(endpoint: string, token: string | undefined, signal: AbortSignal) {
  return sendLogs(
    endpoint,
    TARGET_READS.logs,
    async (client, abortSignal) => {
      const { logGroups, nextToken } = await client.send(
        new DescribeLogGroupsCommand({ limit: 25, nextToken: token }),
        { abortSignal },
      );
      return page(
        (logGroups ?? []).flatMap(({ logGroupArn: arn, logGroupName: name }) =>
          arn && name ? [{ value: arn, label: name, description: arn }] : [],
        ),
        nextToken,
      );
    },
    signal,
  );
}

const readers = { sqs: listTargetQueues, sns: listTargetTopics, logs: listTargetLogGroups };

export function targetChoiceSource(kind: TargetKind, endpoint: string | undefined): ChoiceSource<TargetResource> {
  return {
    key: ['events', 'target-choices', kind],
    endpoint,
    operation: TARGET_READS[kind],
    read: (origin, _text, token, signal) => readers[kind](origin, token, signal),
    optionOf: (resource) => resource,
  };
}
