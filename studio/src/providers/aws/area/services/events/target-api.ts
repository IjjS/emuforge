import { PutTargetsCommand, type PutTargetsResultEntry, type Target } from '@aws-sdk/client-eventbridge';

import { RequestError } from '../../../../../lib/aws/request';
import { sendEvents } from './clients';

export const PUT_TARGETS = 'PutTargets';

export class PutTargetsError extends RequestError {
  constructor(readonly entries: readonly PutTargetsResultEntry[]) {
    super({
      kind: 'other',
      operation: PUT_TARGETS,
      code: entries[0]?.ErrorCode ?? 'Failed entries',
      ...(entries[0]?.ErrorMessage === undefined ? {} : { message: entries[0].ErrorMessage }),
    });
  }
}

export async function putRuleTargets(
  endpoint: string,
  bus: string,
  name: string,
  targets: Target[],
  signal: AbortSignal,
) {
  const answer = await sendEvents(
    endpoint,
    PUT_TARGETS,
    (client, abortSignal) =>
      client.send(new PutTargetsCommand({ EventBusName: bus, Rule: name, Targets: targets }), { abortSignal }),
    signal,
  );
  if (answer.FailedEntryCount || answer.FailedEntries?.length) {
    throw new PutTargetsError(answer.FailedEntries ?? []);
  }
}
