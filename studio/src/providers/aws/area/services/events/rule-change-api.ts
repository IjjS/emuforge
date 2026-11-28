import {
  DeleteRuleCommand,
  DisableRuleCommand,
  EnableRuleCommand,
  RemoveTargetsCommand,
  type RemoveTargetsResultEntry,
} from '@aws-sdk/client-eventbridge';

import { RequestError } from '../../../../../lib/aws/request';
import { sendEvents } from './clients';
import { listRuleTargets, RULE_OPERATIONS } from './rule-api';

export const RULE_CHANGE_OPERATIONS = {
  enable: 'EnableRule',
  disable: 'DisableRule',
  removeTargets: 'RemoveTargets',
  delete: 'DeleteRule',
} as const;

export class RemoveTargetsError extends RequestError {
  constructor(readonly entries: readonly RemoveTargetsResultEntry[]) {
    super({
      kind: 'other',
      operation: RULE_CHANGE_OPERATIONS.removeTargets,
      code: entries[0]?.ErrorCode ?? 'Failed entries',
      ...(entries[0]?.ErrorMessage === undefined ? {} : { message: entries[0].ErrorMessage }),
    });
    this.message = 'Some targets may have been removed.';
  }
}

export class DeleteAfterRemovalError extends RequestError {
  constructor(error: RequestError) {
    super(error.failure);
    this.message = "The rule's targets were removed, but the rule was not deleted.";
  }
}

export async function setRuleEnabled(
  endpoint: string,
  bus: string,
  name: string,
  enabled: boolean,
  signal: AbortSignal,
): Promise<void> {
  const input = { EventBusName: bus, Name: name };
  await sendEvents(
    endpoint,
    enabled ? RULE_CHANGE_OPERATIONS.enable : RULE_CHANGE_OPERATIONS.disable,
    (client, abortSignal) =>
      enabled
        ? client.send(new EnableRuleCommand(input), { abortSignal })
        : client.send(new DisableRuleCommand(input), { abortSignal }),
    signal,
  );
}

async function removeTargets(endpoint: string, bus: string, name: string, ids: string[], signal: AbortSignal) {
  const answer = await sendEvents(
    endpoint,
    RULE_CHANGE_OPERATIONS.removeTargets,
    (client, abortSignal) =>
      client.send(new RemoveTargetsCommand({ EventBusName: bus, Rule: name, Ids: ids }), { abortSignal }),
    signal,
  );
  if (answer.FailedEntryCount || answer.FailedEntries?.length) {
    throw new RemoveTargetsError(answer.FailedEntries ?? []);
  }
}

export function removeRuleTarget(endpoint: string, bus: string, name: string, id: string, signal: AbortSignal) {
  return removeTargets(endpoint, bus, name, [id], signal);
}

export async function deleteRule(endpoint: string, bus: string, name: string, signal: AbortSignal): Promise<void> {
  const targets = await listRuleTargets(endpoint, bus, name, signal);
  const ids = targets.map(({ Id }) => {
    if (Id === undefined) {
      throw new RequestError({
        kind: 'other',
        operation: RULE_OPERATIONS.listTargetsByRule,
        code: 'Missing target ID',
        message: 'A target could not be identified for removal.',
      });
    }
    return Id;
  });
  if (ids.length > 0) await removeTargets(endpoint, bus, name, ids, signal);
  try {
    await sendEvents(
      endpoint,
      RULE_CHANGE_OPERATIONS.delete,
      (client, abortSignal) => client.send(new DeleteRuleCommand({ EventBusName: bus, Name: name }), { abortSignal }),
      signal,
    );
  } catch (error) {
    if (error instanceof RequestError && ids.length > 0) throw new DeleteAfterRemovalError(error);
    throw error;
  }
}
