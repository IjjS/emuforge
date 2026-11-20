import { RunTaskCommand } from '@aws-sdk/client-ecs';

import { sendEcs, text } from './api';
import type { RunRequest } from './run-form';

// "Run task" of S6 (issue 575, design task 2): one `RunTask` through `sendEcs` with its operation's name, so a refusal
// rejects with its `RequestError` carrying the emulator's code and message as they came. The request is sent as
// `run-form.ts` built it.

/** The operation of the run, as a failure names it. */
export const RUN_OPERATION = 'RunTask';

/** What `RunTask` answered: the ids of the tasks it started, in its order, and the reason of each failure. */
export interface RunOutcome {
  taskIds: string[];
  failures: string[];
}

/** A task's id: the last part of its ARN. */
export function taskIdOf(arn: string): string {
  return arn.slice(arn.lastIndexOf('/') + 1);
}

/** `RunTask` with `request`; the tasks it started and its failures' reasons. */
export async function runTask(endpoint: string, request: RunRequest, signal: AbortSignal): Promise<RunOutcome> {
  const output = await sendEcs(
    endpoint,
    RUN_OPERATION,
    (client, abortSignal) => client.send(new RunTaskCommand(request), { abortSignal }),
    signal,
  );
  const taskIds = (output.tasks ?? []).flatMap((task) => {
    const arn = text(task.taskArn);
    return arn === undefined ? [] : [taskIdOf(arn)];
  });
  const failures = (output.failures ?? []).flatMap((failure) => {
    const reason = text(failure.reason) ?? text(failure.detail) ?? text(failure.arn);
    return reason === undefined ? [] : [reason];
  });
  return { taskIds, failures };
}
