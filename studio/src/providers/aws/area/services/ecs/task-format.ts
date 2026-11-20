import { creationDateText } from '../../components/format-date';
import { NONE } from './format';
import type { Task } from './task-api';

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
