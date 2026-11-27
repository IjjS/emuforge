import {
  DescribeEventBusCommand,
  ListEventBusesCommand,
  ListTagsForResourceCommand,
  type DescribeEventBusResponse,
  type EventBus,
} from '@aws-sdk/client-eventbridge';

import { RequestError } from '../../../../../lib/aws/request';
import { tagsToRecord } from '../../components/tags';
import type { TokenPage } from '../../components/use-token-listing';
import { sendEvents } from './clients';

export const BUS_OPERATIONS = {
  listEventBuses: 'ListEventBuses',
  describeEventBus: 'DescribeEventBus',
  listTagsForResource: 'ListTagsForResource',
} as const;

export function listEventBuses(
  endpoint: string,
  prefix: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<EventBus>> {
  return sendEvents(
    endpoint,
    BUS_OPERATIONS.listEventBuses,
    async (client, abortSignal) => {
      const answer = await client.send(
        new ListEventBusesCommand({ Limit: 25, NextToken: token, NamePrefix: prefix || undefined }),
        { abortSignal },
      );
      const items = answer.EventBuses ?? [];
      return answer.NextToken === undefined ? { items } : { items, next: answer.NextToken };
    },
    signal,
  );
}

export type EventBusRead = { kind: 'found'; bus: DescribeEventBusResponse } | { kind: 'not-found'; message?: string };

export async function getEventBus(endpoint: string, name: string, signal: AbortSignal): Promise<EventBusRead> {
  try {
    const { $metadata, ...bus } = await sendEvents(
      endpoint,
      BUS_OPERATIONS.describeEventBus,
      (client, abortSignal) => client.send(new DescribeEventBusCommand({ Name: name }), { abortSignal }),
      signal,
    );
    void $metadata;
    return { kind: 'found', bus };
  } catch (error) {
    if (
      error instanceof RequestError &&
      error.failure.kind === 'other' &&
      error.failure.code === 'ResourceNotFoundException'
    ) {
      const { message } = error.failure;
      return message === undefined ? { kind: 'not-found' } : { kind: 'not-found', message };
    }
    throw error;
  }
}

export async function listResourceTags(
  endpoint: string,
  arn: string,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const { Tags } = await sendEvents(
    endpoint,
    BUS_OPERATIONS.listTagsForResource,
    (client, abortSignal) => client.send(new ListTagsForResourceCommand({ ResourceARN: arn }), { abortSignal }),
    signal,
  );
  return tagsToRecord(
    (Tags ?? []).flatMap(({ Key, Value }) =>
      Key === undefined || Value === undefined ? [] : [{ key: Key, value: Value }],
    ),
  );
}
