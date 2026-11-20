import {
  DescribeTaskDefinitionCommand,
  ListTaskDefinitionFamiliesCommand,
  ListTaskDefinitionsCommand,
  type ContainerDefinition,
  type TaskDefinition,
} from '@aws-sdk/client-ecs';

import { RequestError } from '../../../../../lib/aws/request';
import { count, sendEcs, text } from './api';
import { revisionOf } from './definition-choices';

// The calls of the task definition screens, S7 to S9 (issue 575, design task 4), through `api.ts`'s `sendEcs`,
// mapped to plain typed results. Every value is the emulator's, as it came.

/** The operations of the task definition screens, as a failure names them. */
export const DEFINITION_OPERATIONS = {
  listTaskDefinitionFamilies: 'ListTaskDefinitionFamilies',
  listTaskDefinitions: 'ListTaskDefinitions',
  describeTaskDefinition: 'DescribeTaskDefinition',
} as const;

/** How many families or revisions one page of S7 and S8 asks for. */
export const DEFINITIONS_PAGE_SIZE = 25;

/** A revision's status, as `ListTaskDefinitions` takes it. */
export type RevisionStatus = 'ACTIVE' | 'INACTIVE';

/** The code and message the emulator answers for a revision it cannot describe. */
const NOT_FOUND_CODE = 'ClientException';
const NOT_FOUND_MESSAGE = 'Unable to describe task definition.';

/** One page of families or revisions, in the API's order, and its token. */
export interface DefinitionPage<T> {
  items: T[];
  nextToken?: string;
}

/**
 * S7's page: `ListTaskDefinitionFamilies` with `status` `ACTIVE`, `maxResults` 25, the token, and `familyPrefix` only
 * when a text is given.
 */
export async function listFamilies(
  endpoint: string,
  prefix: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<DefinitionPage<string>> {
  const output = await sendEcs(
    endpoint,
    DEFINITION_OPERATIONS.listTaskDefinitionFamilies,
    (client, abortSignal) =>
      client.send(
        new ListTaskDefinitionFamiliesCommand({
          status: 'ACTIVE',
          maxResults: DEFINITIONS_PAGE_SIZE,
          ...(prefix === '' ? {} : { familyPrefix: prefix }),
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.families ?? []).flatMap((family) => {
    const name = text(family);
    return name === undefined ? [] : [name];
  });
  const next = text(output.nextToken);
  return next === undefined ? { items } : { items, nextToken: next };
}

/** A revision as S8 lists it. */
export interface RevisionRow {
  /** `family:revision`. */
  value: string;
  family: string;
  revision: number;
}

/**
 * S8's page: `ListTaskDefinitions` with `familyPrefix` the family, `status`, `sort` `DESC`, `maxResults` (25 unless
 * given) and the token; each row `family:revision` from its ARN, the family's own only.
 */
export async function listRevisions(
  endpoint: string,
  family: string,
  status: RevisionStatus,
  token: string | undefined,
  signal: AbortSignal,
  maxResults: number = DEFINITIONS_PAGE_SIZE,
): Promise<DefinitionPage<RevisionRow>> {
  const output = await sendEcs(
    endpoint,
    DEFINITION_OPERATIONS.listTaskDefinitions,
    (client, abortSignal) =>
      client.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: family,
          status,
          sort: 'DESC',
          maxResults,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.taskDefinitionArns ?? []).flatMap((arn) => {
    const row = typeof arn === 'string' ? revisionOf(arn) : undefined;
    return row === undefined || row.family !== family ? [] : [row];
  });
  const next = text(output.nextToken);
  return next === undefined ? { items } : { items, nextToken: next };
}

/** A container of a revision as S9's table shows it. A value the answer lacks is absent. */
export interface RevisionContainer {
  name: string;
  image?: string;
  /** `essential` as answered; absent when the answer gave none. */
  essential?: boolean;
  command?: string[];
  ports: { containerPort: number; protocol?: string }[];
  /** The `awslogs-group` of an `awslogs` configuration. */
  logGroup?: string;
}

/** A revision as S9 shows it. A value the answer lacks is absent. */
export interface Revision {
  family: string;
  revision: number;
  arn?: string;
  status: string;
  networkMode?: string;
  compatibilities: string[];
  cpu?: string;
  memory?: string;
  executionRoleArn?: string;
  taskRoleArn?: string;
  registeredAt?: Date;
  containers: RevisionContainer[];
  /** The answer's `taskDefinition`, as the emulator gave it, for S9's JSON. */
  answer: TaskDefinition;
}

/** A revision read: the revision, or "not found" (the emulator cannot describe it). */
export type RevisionRead = { found: true; revision: Revision } | { found: false };

function containerOf(raw: ContainerDefinition): RevisionContainer | undefined {
  const name = text(raw.name);
  if (name === undefined) {
    return undefined;
  }
  const container: RevisionContainer = {
    name,
    ports: (raw.portMappings ?? []).flatMap((mapping) => {
      const port = count(mapping.containerPort);
      if (port === undefined) {
        return [];
      }
      const protocol = text(mapping.protocol);
      return [protocol === undefined ? { containerPort: port } : { containerPort: port, protocol }];
    }),
  };
  const image = text(raw.image);
  if (image !== undefined) container.image = image;
  if (typeof raw.essential === 'boolean') container.essential = raw.essential;
  if (Array.isArray(raw.command)) container.command = raw.command.filter((word) => typeof word === 'string');
  if (raw.logConfiguration?.logDriver === 'awslogs') {
    const group = text(raw.logConfiguration.options?.['awslogs-group']);
    if (group !== undefined) container.logGroup = group;
  }
  return container;
}

function revisionOfAnswer(raw: TaskDefinition, family: string, revision: number): Revision {
  const read: Revision = {
    family: text(raw.family) ?? family,
    revision: count(raw.revision) ?? revision,
    status: text(raw.status) ?? '',
    compatibilities: (raw.compatibilities ?? []).flatMap((value) => {
      const word = text(value);
      return word === undefined ? [] : [word];
    }),
    containers: (raw.containerDefinitions ?? []).flatMap((container) => {
      const read = containerOf(container);
      return read === undefined ? [] : [read];
    }),
    answer: raw,
  };
  const arn = text(raw.taskDefinitionArn);
  if (arn !== undefined) read.arn = arn;
  const networkMode = text(raw.networkMode);
  if (networkMode !== undefined) read.networkMode = networkMode;
  const cpu = text(raw.cpu);
  if (cpu !== undefined) read.cpu = cpu;
  const memory = text(raw.memory);
  if (memory !== undefined) read.memory = memory;
  const execution = text(raw.executionRoleArn);
  if (execution !== undefined) read.executionRoleArn = execution;
  const task = text(raw.taskRoleArn);
  if (task !== undefined) read.taskRoleArn = task;
  if (raw.registeredAt instanceof Date && !Number.isNaN(raw.registeredAt.getTime())) {
    read.registeredAt = raw.registeredAt;
  }
  return read;
}

/**
 * S9's read: `DescribeTaskDefinition` of `family:revision`; `ClientException` "Unable to describe task definition."
 * is "not found", any other refusal a failure.
 */
export async function getRevision(
  endpoint: string,
  family: string,
  revision: number,
  signal: AbortSignal,
): Promise<RevisionRead> {
  try {
    const output = await sendEcs(
      endpoint,
      DEFINITION_OPERATIONS.describeTaskDefinition,
      (client, abortSignal) =>
        client.send(new DescribeTaskDefinitionCommand({ taskDefinition: `${family}:${String(revision)}` }), {
          abortSignal,
        }),
      signal,
    );
    const answer = output.taskDefinition;
    return answer === undefined
      ? { found: false }
      : { found: true, revision: revisionOfAnswer(answer, family, revision) };
  } catch (error) {
    if (
      error instanceof RequestError &&
      error.failure.kind === 'other' &&
      error.failure.code === NOT_FOUND_CODE &&
      error.failure.message === NOT_FOUND_MESSAGE
    ) {
      return { found: false };
    }
    throw error;
  }
}
