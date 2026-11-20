import { RegisterTaskDefinitionCommand, type RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';

import { count, sendEcs, text } from './api';
import { revisionOf } from './definition-choices';

// "Register" of S10 (issue 575, design task 4): one `RegisterTaskDefinition` through `sendEcs` with its operation's
// name, its input the object of the field unchanged, so a refusal rejects with its `RequestError` carrying the
// emulator's code and message as they came.

/** The operation of the register, as a failure names it. */
export const REGISTER_OPERATION = 'RegisterTaskDefinition';

/** The revision the emulator registered. */
export interface Registered {
  family: string;
  revision: number;
}

/** `RegisterTaskDefinition` with `input` as it is; the answer's family and revision. */
export async function registerTaskDefinition(
  endpoint: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Registered> {
  const output = await sendEcs(
    endpoint,
    REGISTER_OPERATION,
    (client, abortSignal) =>
      client.send(new RegisterTaskDefinitionCommand(input as unknown as RegisterTaskDefinitionCommandInput), {
        abortSignal,
      }),
    signal,
  );
  const answer = output.taskDefinition;
  const family = text(answer?.family);
  const revision = count(answer?.revision);
  if (family !== undefined && revision !== undefined) {
    return { family, revision };
  }
  const arn = text(answer?.taskDefinitionArn);
  const fromArn = arn === undefined ? undefined : revisionOf(arn);
  if (fromArn === undefined) {
    throw new Error('The emulator answered RegisterTaskDefinition without the revision it registered.');
  }
  return { family: fromArn.family, revision: fromArn.revision };
}
