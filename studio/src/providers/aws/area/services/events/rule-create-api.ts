import { PutRuleCommand, type PutRuleCommandInput } from '@aws-sdk/client-eventbridge';

import { sendEvents } from './clients';
import { getRule } from './rule-api';

export const PUT_RULE = 'PutRule';

export async function ruleNameTaken(
  endpoint: string,
  bus: string,
  name: string,
  signal: AbortSignal,
): Promise<boolean> {
  return (await getRule(endpoint, bus, name, signal)).kind === 'found';
}

export async function createRule(endpoint: string, input: PutRuleCommandInput, signal: AbortSignal): Promise<void> {
  await sendEvents(
    endpoint,
    PUT_RULE,
    (client, abortSignal) => client.send(new PutRuleCommand(input), { abortSignal }),
    signal,
  );
}
