import { DescribeLogGroupsCommand, ListTagsLogGroupCommand, type LogGroup } from '@aws-sdk/client-cloudwatch-logs';

import type { TokenPage } from '../../components/use-token-listing';
import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const OPERATIONS = {
  describeLogGroups: 'DescribeLogGroups',
  listTagsLogGroup: 'ListTagsLogGroup',
} as const;

const LOG_GROUP_PAGE_SIZE = 25;

export function listLogGroups(
  endpoint: string,
  pattern: string,
  token: string | undefined,
  signal: AbortSignal,
  { namesOnly = false }: { namesOnly?: boolean } = {},
): Promise<TokenPage<LogGroup>> {
  return sendLogs(
    endpoint,
    OPERATIONS.describeLogGroups,
    async (client, abortSignal) => {
      let next = token;
      for (;;) {
        abortSignal.throwIfAborted();
        const answer = await client.send(
          new DescribeLogGroupsCommand({
            limit: LOG_GROUP_PAGE_SIZE,
            logGroupNamePattern: pattern === '' ? undefined : pattern,
            nextToken: next,
          }),
          { abortSignal },
        );
        let items = answer.logGroups ?? [];
        next = answer.nextToken;
        if (items.length === 0 && next !== undefined) continue;

        if (pattern !== '' && !namesOnly) {
          // A pattern read omits retention and deletion protection.
          const names = items.flatMap(({ logGroupName }) => logGroupName ?? []);
          if (names.length > 0) {
            abortSignal.throwIfAborted();
            const details = await client.send(
              new DescribeLogGroupsCommand({ logGroupIdentifiers: names.slice(0, LOG_GROUP_PAGE_SIZE) }),
              { abortSignal },
            );
            const byName = new Map((details.logGroups ?? []).map((group) => [group.logGroupName, group]));
            items = items.map((group) =>
              group.logGroupName === undefined ? group : (byName.get(group.logGroupName) ?? group),
            );
          }
        }
        return next === undefined ? { items } : { items, next };
      }
    },
    signal,
  );
}

export type LogGroupRead = { kind: 'found'; group: LogGroup } | { kind: 'not-found' };

export async function getLogGroup(endpoint: string, name: string, signal: AbortSignal): Promise<LogGroupRead> {
  const answer = await sendLogs(
    endpoint,
    OPERATIONS.describeLogGroups,
    (client, abortSignal) =>
      client.send(new DescribeLogGroupsCommand({ logGroupIdentifiers: [name] }), { abortSignal }),
    signal,
  );
  const [group] = answer.logGroups ?? [];
  return group === undefined ? { kind: 'not-found' } : { kind: 'found', group };
}

export async function listLogGroupTags(
  endpoint: string,
  name: string,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const answer = await sendLogs(
    endpoint,
    OPERATIONS.listTagsLogGroup,
    (client, abortSignal) => client.send(new ListTagsLogGroupCommand({ logGroupName: name }), { abortSignal }),
    signal,
  );
  return answer.tags ?? {};
}
