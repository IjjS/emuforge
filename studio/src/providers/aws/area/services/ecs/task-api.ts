import {
  DescribeTasksCommand,
  ListTasksCommand,
  StopTaskCommand,
  type Container as SdkContainer,
  type Task as SdkTask,
} from '@aws-sdk/client-ecs';

import { count, sendEcs, text } from './api';
import { definitionOf, taskIdOf, type Definition } from './task-format';

// The calls of a cluster's tasks (issue 575, design tasks 1 and 2): a page of the tasks table, one task for S5, and
// "Stop task", each through `api.ts`'s `sendEcs`, mapped to plain typed results. Every value is the emulator's, as it
// came; a value the answer lacks is absent.

/** The operations of the task screens, as a failure names them. */
export const TASK_OPERATIONS = {
  listTasks: 'ListTasks',
  describeTasks: 'DescribeTasks',
  stopTask: 'StopTask',
} as const;

/** How many tasks one page of a tasks table asks for. */
export const TASKS_PAGE_SIZE = 25;

/** A desired status the tasks table lists by: every task not stopped, or the stopped ones. */
export type DesiredStatus = 'RUNNING' | 'STOPPED';

/** A container of a task, as S5's table shows it. */
export interface TaskContainer {
  name: string;
  image?: string;
  status?: string;
  /** The exit code, 0 kept as 0. */
  exitCode?: number;
  reason?: string;
}

/** A task as the tasks table and S5 show it. */
export interface Task {
  /** The last part of its ARN. */
  id: string;
  arn: string;
  lastStatus?: string;
  desiredStatus?: string;
  /** `taskDefinitionArn` as answered. */
  definitionArn?: string;
  /** Its revision, read from `definitionArn`. */
  definition?: Definition;
  /** `service:<name>` or `family:<family>`, as the emulator gives it. */
  group?: string;
  launchType?: string;
  startedBy?: string;
  createdAt?: Date;
  startedAt?: Date;
  stoppedAt?: Date;
  stopCode?: string;
  stoppedReason?: string;
  cpu?: string;
  memory?: string;
  /** From the network attachment's details. */
  subnet?: string;
  networkInterface?: string;
  privateIp?: string;
  containers: TaskContainer[];
}

function date(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

function containerOf(raw: SdkContainer): TaskContainer | undefined {
  const name = text(raw.name);
  if (name === undefined) {
    return undefined;
  }
  const container: TaskContainer = { name };
  const image = text(raw.image);
  if (image !== undefined) container.image = image;
  const status = text(raw.lastStatus);
  if (status !== undefined) container.status = status;
  const exitCode = count(raw.exitCode);
  if (exitCode !== undefined) container.exitCode = exitCode;
  const reason = text(raw.reason);
  if (reason !== undefined) container.reason = reason;
  return container;
}

/** The value of the detail `name` of the task's network attachment. */
function detailOf(raw: SdkTask, name: string): string | undefined {
  for (const attachment of raw.attachments ?? []) {
    for (const detail of attachment.details ?? []) {
      if (detail.name === name) {
        const value = text(detail.value);
        if (value !== undefined) {
          return value;
        }
      }
    }
  }
  return undefined;
}

/** A task of an answer; one without an ARN is none. */
export function taskOf(raw: SdkTask): Task | undefined {
  const arn = text(raw.taskArn);
  if (arn === undefined) {
    return undefined;
  }
  const task: Task = { id: taskIdOf(arn), arn, containers: [] };
  const texts = {
    lastStatus: text(raw.lastStatus),
    desiredStatus: text(raw.desiredStatus),
    definitionArn: text(raw.taskDefinitionArn),
    group: text(raw.group),
    launchType: text(raw.launchType),
    startedBy: text(raw.startedBy),
    stopCode: text(raw.stopCode),
    stoppedReason: text(raw.stoppedReason),
    cpu: text(raw.cpu),
    memory: text(raw.memory),
    subnet: detailOf(raw, 'subnetId'),
    networkInterface: detailOf(raw, 'networkInterfaceId'),
    privateIp: detailOf(raw, 'privateIPv4Address'),
  } as const;
  for (const [key, value] of Object.entries(texts) as [keyof typeof texts, string | undefined][]) {
    if (value !== undefined) task[key] = value;
  }
  const definition = task.definitionArn === undefined ? undefined : definitionOf(task.definitionArn);
  if (definition !== undefined) task.definition = definition;
  const createdAt = date(raw.createdAt);
  if (createdAt !== undefined) task.createdAt = createdAt;
  const startedAt = date(raw.startedAt);
  if (startedAt !== undefined) task.startedAt = startedAt;
  const stoppedAt = date(raw.stoppedAt);
  if (stoppedAt !== undefined) task.stoppedAt = stoppedAt;
  task.containers = (raw.containers ?? []).flatMap((container) => {
    const read = containerOf(container);
    return read === undefined ? [] : [read];
  });
  return task;
}

/** What a tasks table lists by: the desired status, and a service's name for a service's table. */
export interface TaskFilters {
  desiredStatus: DesiredStatus;
  service?: string;
}

/** One page of a tasks table: its tasks in the order `ListTasks` gave their ARNs, and its token. */
export interface TaskPage {
  tasks: Task[];
  nextToken?: string;
}

/**
 * A page of the cluster's tasks: `ListTasks` with the cluster, `desiredStatus`, `serviceName` when given,
 * `maxResults` 25 and the page's token, then one `DescribeTasks` of the ARNs it answered; no ARN sends no
 * `DescribeTasks`.
 */
export async function listTasks(
  endpoint: string,
  cluster: string,
  filters: TaskFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TaskPage> {
  const listed = await sendEcs(
    endpoint,
    TASK_OPERATIONS.listTasks,
    (client, abortSignal) =>
      client.send(
        new ListTasksCommand({
          cluster,
          desiredStatus: filters.desiredStatus,
          ...(filters.service === undefined ? {} : { serviceName: filters.service }),
          maxResults: TASKS_PAGE_SIZE,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const arns = (listed.taskArns ?? []).filter((arn) => text(arn) !== undefined);
  const page: TaskPage = { tasks: [] };
  const next = text(listed.nextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  if (arns.length === 0) {
    return page;
  }
  const described = await sendEcs(
    endpoint,
    TASK_OPERATIONS.describeTasks,
    (client, abortSignal) => client.send(new DescribeTasksCommand({ cluster, tasks: arns }), { abortSignal }),
    signal,
  );
  const byArn = new Map<string, Task>();
  for (const raw of described.tasks ?? []) {
    const task = taskOf(raw);
    if (task !== undefined) {
      byArn.set(task.arn, task);
    }
  }
  page.tasks = arns.flatMap((arn) => {
    const task = byArn.get(arn);
    return task === undefined ? [] : [task];
  });
  return page;
}

/** A task read: the task, or "not found" (a failure `MISSING`, or no task answered). */
export type TaskRead = { found: true; task: Task } | { found: false };

/** S5's read of the task `id` of the cluster `cluster`: `DescribeTasks` of it. */
export async function getTask(endpoint: string, cluster: string, id: string, signal: AbortSignal): Promise<TaskRead> {
  const output = await sendEcs(
    endpoint,
    TASK_OPERATIONS.describeTasks,
    (client, abortSignal) => client.send(new DescribeTasksCommand({ cluster, tasks: [id] }), { abortSignal }),
    signal,
  );
  const task = (output.tasks ?? []).map(taskOf).find((candidate) => candidate !== undefined && candidate.id === id);
  return task === undefined ? { found: false } : { found: true, task };
}

/** "Stop task": `StopTask` with the cluster and the task. */
export async function stopTask(endpoint: string, cluster: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEcs(
    endpoint,
    TASK_OPERATIONS.stopTask,
    (client, abortSignal) => client.send(new StopTaskCommand({ cluster, task: id }), { abortSignal }),
    signal,
  );
}
