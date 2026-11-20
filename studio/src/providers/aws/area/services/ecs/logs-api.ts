import { GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeTaskDefinitionCommand, type ContainerDefinition } from '@aws-sdk/client-ecs';

import { RequestError } from '../../../../../lib/aws/request';
import { count, sendEcs, sendLogs, text } from './api';

// The calls of a task's log (issue 575, design task 3): the log configurations of its definition's containers
// (`DescribeTaskDefinition`, through `sendEcs`) and a stream's lines (CloudWatch Logs `GetLogEvents`, through
// `sendLogs`). A stream or a group that is not there is "no line yet", not a failure: a task that did not start has
// none. Every value is the emulator's, as it came.

/** The operations of a task's log, as a failure names them. */
export const LOG_OPERATIONS = {
  describeTaskDefinition: 'DescribeTaskDefinition',
  getLogEvents: 'GetLogEvents',
} as const;

/** How many lines one read of a stream asks for. */
export const LOG_LINES_LIMIT = 200;

/** Where a container's log is: its group and its stream. */
export interface LogStream {
  group: string;
  stream: string;
}

/** A container of a task's definition and where its log is; none without `awslogs` and a stream prefix. */
export interface ContainerLog {
  container: string;
  log?: LogStream;
}

function logOf(definition: ContainerDefinition, container: string, task: string): LogStream | undefined {
  const configuration = definition.logConfiguration;
  if (configuration?.logDriver !== 'awslogs') {
    return undefined;
  }
  const group = text(configuration.options?.['awslogs-group']);
  const prefix = text(configuration.options?.['awslogs-stream-prefix']);
  return group === undefined || prefix === undefined
    ? undefined
    : { group, stream: `${prefix}/${container}/${task}` };
}

/**
 * The log of each container of the definition `definition` (its ARN, or `family:revision`) for the task `task` (its
 * id): the group and the stream `{prefix}/{container}/{task}` of an `awslogs` configuration with a stream prefix.
 */
export async function getContainerLogs(
  endpoint: string,
  definition: string,
  task: string,
  signal: AbortSignal,
): Promise<ContainerLog[]> {
  const output = await sendEcs(
    endpoint,
    LOG_OPERATIONS.describeTaskDefinition,
    (client, abortSignal) =>
      client.send(new DescribeTaskDefinitionCommand({ taskDefinition: definition }), { abortSignal }),
    signal,
  );
  return (output.taskDefinition?.containerDefinitions ?? []).flatMap((raw) => {
    const container = text(raw.name);
    if (container === undefined) {
      return [];
    }
    const log = logOf(raw, container, task);
    return [log === undefined ? { container } : { container, log }];
  });
}

/** One line of a log: the time the emulator gave it, and its message as it came. */
export interface LogLine {
  time?: Date;
  message: string;
}

/** One read of a stream: its lines in the order answered, and the token to read on from. */
export interface LogLines {
  lines: LogLine[];
  nextToken?: string;
}

const NOT_THERE = 'ResourceNotFoundException';

/**
 * The lines of `log` from its head (`startFromHead`, `limit` 200), or from `token` on. A group or a stream that is
 * not there answers no line and no token; any other refusal is the failure.
 */
export async function getLogLines(
  endpoint: string,
  log: LogStream,
  token: string | undefined,
  signal: AbortSignal,
): Promise<LogLines> {
  try {
    const output = await sendLogs(
      endpoint,
      LOG_OPERATIONS.getLogEvents,
      (client, abortSignal) =>
        client.send(
          new GetLogEventsCommand({
            logGroupName: log.group,
            logStreamName: log.stream,
            startFromHead: true,
            limit: LOG_LINES_LIMIT,
            ...(token === undefined ? {} : { nextToken: token }),
          }),
          { abortSignal },
        ),
      signal,
    );
    const read: LogLines = {
      lines: (output.events ?? []).map((event) => {
        const time = count(event.timestamp);
        const line: LogLine = { message: event.message ?? '' };
        if (time !== undefined) line.time = new Date(time);
        return line;
      }),
    };
    const next = text(output.nextForwardToken);
    if (next !== undefined) {
      read.nextToken = next;
    }
    return read;
  } catch (error) {
    if (error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === NOT_THERE) {
      return { lines: [] };
    }
    throw error;
  }
}
