import {
  DescribeRuleCommand,
  ListRulesCommand,
  ListTargetsByRuleCommand,
  type DescribeRuleResponse,
  type Rule,
  type Target,
} from '@aws-sdk/client-eventbridge';

import { RequestError } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import { sendEvents } from './clients';

export const RULE_OPERATIONS = {
  listRules: 'ListRules',
  describeRule: 'DescribeRule',
  listTargetsByRule: 'ListTargetsByRule',
} as const;

export function listRules(
  endpoint: string,
  bus: string,
  prefix: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Rule>> {
  return sendEvents(
    endpoint,
    RULE_OPERATIONS.listRules,
    async (client, abortSignal) => {
      const answer = await client.send(
        new ListRulesCommand({ EventBusName: bus, Limit: 25, NextToken: token, NamePrefix: prefix || undefined }),
        { abortSignal },
      );
      const items = answer.Rules ?? [];
      return answer.NextToken === undefined ? { items } : { items, next: answer.NextToken };
    },
    signal,
  );
}

export type RuleRead = { kind: 'found'; rule: DescribeRuleResponse } | { kind: 'not-found'; message?: string };

export async function getRule(endpoint: string, bus: string, name: string, signal: AbortSignal): Promise<RuleRead> {
  try {
    const { $metadata, ...rule } = await sendEvents(
      endpoint,
      RULE_OPERATIONS.describeRule,
      (client, abortSignal) => client.send(new DescribeRuleCommand({ EventBusName: bus, Name: name }), { abortSignal }),
      signal,
    );
    void $metadata;
    return { kind: 'found', rule };
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

export function listRuleTargets(endpoint: string, bus: string, rule: string, signal: AbortSignal): Promise<Target[]> {
  return sendEvents(
    endpoint,
    RULE_OPERATIONS.listTargetsByRule,
    async (client, abortSignal) => {
      const targets: Target[] = [];
      let token: string | undefined;
      do {
        abortSignal.throwIfAborted();
        const answer = await client.send(
          new ListTargetsByRuleCommand({ EventBusName: bus, Rule: rule, NextToken: token }),
          { abortSignal },
        );
        targets.push(...(answer.Targets ?? []));
        token = answer.NextToken;
      } while (token !== undefined);
      return targets;
    },
    signal,
  );
}
