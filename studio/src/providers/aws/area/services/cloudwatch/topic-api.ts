import { ListTopicsCommand } from '@aws-sdk/client-sns';

import type { TokenPage } from '../../components/use-token-listing';
import { sendSns } from './clients';

export const LIST_TOPICS = 'ListTopics';

export async function listTopics(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<string>> {
  const command = new ListTopicsCommand(token === undefined ? {} : { NextToken: token });
  const answer = await sendSns(
    endpoint,
    LIST_TOPICS,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return {
    items: (answer.Topics ?? []).flatMap(({ TopicArn }) => (TopicArn ? [TopicArn] : [])),
    ...(answer.NextToken === undefined ? {} : { next: answer.NextToken }),
  };
}

export async function listTopicArns(endpoint: string, signal: AbortSignal): Promise<string[]> {
  const topics: string[] = [];
  let token: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await listTopics(endpoint, token, signal);
    topics.push(...page.items);
    token = page.next;
  } while (token);
  return topics;
}
