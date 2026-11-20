import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import { creationDateText } from '../../components/format-date';
import type { RevisionContainer } from './definition-api';
import { NONE } from './format';
import type { Task, TaskContainer } from './task-api';

// How the task screens read and write a task's values (issue 575, R4, S5 and the tasks table): its id from its ARN,
// its revision from its definition's ARN, the service of its group, and each value of S5's summary as text, an
// absent one as "-".

/** A revision of a family, as a task names it. */
export interface Definition {
  family: string;
  revision: number;
}

/** A task's id: the last part of its ARN. */
export function taskIdOf(arn: string): string {
  const at = arn.lastIndexOf('/');
  return at === -1 ? arn : arn.slice(at + 1);
}

/** The revision a task definition's ARN names (`…:task-definition/web:3`); none when it names no number. */
export function definitionOf(arn: string): Definition | undefined {
  const name = arn.slice(arn.lastIndexOf('/') + 1);
  const at = name.lastIndexOf(':');
  if (at <= 0) {
    return undefined;
  }
  const revision = Number(name.slice(at + 1));
  return Number.isInteger(revision) && revision > 0 ? { family: name.slice(0, at), revision } : undefined;
}

/** `family:revision`. */
export function definitionText(definition: Definition): string {
  return `${definition.family}:${String(definition.revision)}`;
}

const SERVICE_GROUP = 'service:';

/** The service's name of a group `service:web`; none for a `family:` group or none at all. */
export function serviceOfGroup(group: string | undefined): string | undefined {
  if (group?.startsWith(SERVICE_GROUP) !== true) {
    return undefined;
  }
  const name = group.slice(SERVICE_GROUP.length);
  return name === '' ? undefined : name;
}

/** The values of S5's summary that are text, dates and numbers, each "-" when the answer lacks it. */
export interface TaskTexts {
  lastStatus: string;
  desiredStatus: string;
  definition: string;
  group: string;
  launchType: string;
  startedBy: string;
  cpu: string;
  memory: string;
  createdAt: string;
  startedAt: string;
  stoppedAt: string;
  stopCode: string;
  stoppedReason: string;
  privateIp: string;
  subnet: string;
  networkInterface: string;
}

/** A value as text, "-" when absent. */
export function orNone(value: string | undefined): string {
  return value === undefined || value === '' ? NONE : value;
}

/** A task's values as S5's summary writes them; statuses are left to `statusText`. */
export function taskTexts(task: Task): TaskTexts {
  return {
    lastStatus: orNone(task.lastStatus),
    desiredStatus: orNone(task.desiredStatus),
    definition: task.definition === undefined ? orNone(task.definitionArn) : definitionText(task.definition),
    group: orNone(task.group),
    launchType: orNone(task.launchType),
    startedBy: orNone(task.startedBy),
    cpu: orNone(task.cpu),
    memory: orNone(task.memory),
    createdAt: creationDateText(task.createdAt),
    startedAt: creationDateText(task.startedAt),
    stoppedAt: creationDateText(task.stoppedAt),
    stopCode: orNone(task.stopCode),
    stoppedReason: orNone(task.stoppedReason),
    privateIp: orNone(task.privateIp),
    subnet: orNone(task.subnet),
    networkInterface: orNone(task.networkInterface),
  };
}

/** A container's exit code as text: 0 as "0", none as "-". */
export function exitCodeText(code: number | undefined): string {
  return code === undefined ? NONE : String(code);
}

/** How S5 shows a task's last status (critique final r1): Cloudscape's `StatusIndicator` type of each ECS status. */
export function lastStatusType(status: string | undefined): StatusIndicatorProps.Type {
  switch (status) {
    case 'RUNNING':
      return 'success';
    case 'STOPPED':
      return 'stopped';
    case 'PROVISIONING':
    case 'PENDING':
    case 'ACTIVATING':
      return 'pending';
    case 'DEACTIVATING':
    case 'STOPPING':
    case 'DEPROVISIONING':
      return 'in-progress';
    default:
      return 'info';
  }
}

/**
 * The essential containers of a task (critique final r1), whose exit codes tell how a stopped task ended. A task's
 * own answer does not say which container is essential, its revision does: a task of one container needs no revision;
 * of several, those its revision does not mark `essential: false`. None is known while the revision is not read.
 */
export function essentialContainers(
  task: Task,
  revision: readonly Pick<RevisionContainer, 'name' | 'essential'>[] | undefined,
): TaskContainer[] | undefined {
  if (task.containers.length === 1) {
    return task.containers;
  }
  if (revision === undefined) {
    return undefined;
  }
  const essential = new Set(revision.filter((container) => container.essential !== false).map((c) => c.name));
  return task.containers.filter((container) => essential.has(container.name));
}

/**
 * How S5 tells a stopped task's end (critique final r3), decided by its stop code: `TaskFailedToStart` is an error,
 * and so is `EssentialContainerExited` with an essential container's exit code other than 0; any other code is info
 * whatever the exit code, as a task stopped by "Stop task" (`UserInitiated`) or by a deployment
 * (`ServiceSchedulerInitiated`) exits with the 143 of SIGTERM and did not fail.
 */
export function stopOutcomeType(
  stopCode: string | undefined,
  essential: readonly Pick<TaskContainer, 'exitCode'>[] | undefined,
): 'error' | 'info' {
  if (stopCode === 'TaskFailedToStart') {
    return 'error';
  }
  const nonZero = (essential ?? []).some((container) => container.exitCode !== undefined && container.exitCode !== 0);
  return stopCode === 'EssentialContainerExited' && nonZero ? 'error' : 'info';
}

/** Whether a task needs its revision read to know its essential containers: stopped, of several containers. */
export function needsRevision(task: Task): boolean {
  return task.lastStatus === 'STOPPED' && task.containers.length > 1 && task.definition !== undefined;
}
