import {
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  RDSClient,
  RebootDBInstanceCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  type DBInstance as SdkInstance,
  type Filter,
  type Tag as SdkTag,
} from '@aws-sdk/client-rds';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import type { Tag } from './format';
import type { InstanceAction } from './status';

// The calls of RDS's DB instance screens (issue 573, design tasks 1 and 3), through the engine, mapped to plain typed
// results, and the one place RDS's client class meets the factory: every other API file of the folder sends its
// commands through `sendRds`. Every command goes through the shared `sendRequest` with its operation's name, so a
// failed request rejects with its `RequestError` and an aborted one with the signal's reason. Every value is the
// emulator's, as it came; the master password, which the API never returns past a creation, is never read.

/** The operations of the DB instance screens, as a failure names them. */
export const OPERATIONS = {
  describeDBInstances: 'DescribeDBInstances',
  startDBInstance: 'StartDBInstance',
  stopDBInstance: 'StopDBInstance',
  rebootDBInstance: 'RebootDBInstance',
  deleteDBInstance: 'DeleteDBInstance',
} as const;

/** How many DB instances one page of S1 asks for. */
export const INSTANCES_PAGE_SIZE = 50;

/** RDS's answer for a DB instance it does not hold. */
const INSTANCE_NOT_FOUND = 'DBInstanceNotFound';

const clients = new Map<string, RDSClient>();

function rdsClient(endpoint: string): RDSClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(RDSClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

/**
 * One request of `operation` to RDS at the engine `endpoint`: `send` is handed the client and the signal to send its
 * command with. What every API file of the folder sends through.
 */
export function sendRds<T>(
  endpoint: string,
  operation: string,
  send: (client: RDSClient, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => send(rdsClient(endpoint), abortSignal), signal);
}

/** Whether `error` is a refusal with `code`. */
export function isCode(error: unknown, code: string): boolean {
  return error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === code;
}

/** `value` when it is a text that is not empty. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `value` when it is a finite number. */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `value` when it is a valid date. */
export function dateOf(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

/** The tags of an answer, in its order; a tag without a key is left out. */
export function tagsOf(tags: readonly SdkTag[] | undefined): Tag[] {
  return (tags ?? []).flatMap((tag) => {
    const key = text(tag.Key);
    return key === undefined ? [] : [{ key, value: tag.Value ?? '' }];
  });
}

/** Copies the values of `values` that are not `undefined` onto `target`. */
export function withValues<T extends object>(target: T, values: { [K in keyof T]?: T[K] | undefined }): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

// ---------------------------------------------------------------------------------------------------------------
// DB instances

/** A security group a DB instance names, with the status the instance reports for it. */
export interface InstanceSecurityGroup {
  id: string;
  status?: string;
}

/** A DB instance's DB subnet group. */
export interface InstanceSubnetGroup {
  name: string;
  vpcId?: string;
  subnets: string[];
}

/** A DB instance as S1, S3 and a cluster's members show it. A value the answer lacks is absent. */
export interface DbInstance {
  id: string;
  /** `DBInstanceStatus` as the API names it; empty when the answer gave none. */
  status: string;
  engine?: string;
  engineVersion?: string;
  instanceClass?: string;
  /** The DB cluster it is a member of. */
  clusterId?: string;
  address?: string;
  port?: number;
  createdAt?: Date;
  masterUsername?: string;
  dbName?: string;
  allocatedStorage?: number;
  storageType?: string;
  zone?: string;
  arn?: string;
  resourceId?: string;
  parameterGroups: string[];
  subnetGroup?: InstanceSubnetGroup;
  securityGroups: InstanceSecurityGroup[];
  deletionProtection: boolean;
  tags: Tag[];
}

/** A DB instance of an answer; `undefined` without an identifier. What `cluster-api.ts` maps a member with. */
export function instanceOf(raw: SdkInstance): DbInstance | undefined {
  const id = text(raw.DBInstanceIdentifier);
  if (id === undefined) {
    return undefined;
  }
  const subnetGroupName = text(raw.DBSubnetGroup?.DBSubnetGroupName);
  return withValues<DbInstance>(
    {
      id,
      status: text(raw.DBInstanceStatus) ?? '',
      parameterGroups: (raw.DBParameterGroups ?? []).flatMap((group) => {
        const name = text(group.DBParameterGroupName);
        return name === undefined ? [] : [name];
      }),
      securityGroups: (raw.VpcSecurityGroups ?? []).flatMap((group) => {
        const groupId = text(group.VpcSecurityGroupId);
        return groupId === undefined
          ? []
          : [withValues<InstanceSecurityGroup>({ id: groupId }, { status: text(group.Status) })];
      }),
      deletionProtection: raw.DeletionProtection === true,
      tags: tagsOf(raw.TagList),
    },
    {
      engine: text(raw.Engine),
      engineVersion: text(raw.EngineVersion),
      instanceClass: text(raw.DBInstanceClass),
      clusterId: text(raw.DBClusterIdentifier),
      address: text(raw.Endpoint?.Address),
      port: numberOf(raw.Endpoint?.Port),
      createdAt: dateOf(raw.InstanceCreateTime),
      masterUsername: text(raw.MasterUsername),
      dbName: text(raw.DBName),
      allocatedStorage: numberOf(raw.AllocatedStorage),
      storageType: text(raw.StorageType),
      zone: text(raw.AvailabilityZone),
      arn: text(raw.DBInstanceArn),
      resourceId: text(raw.DbiResourceId),
      subnetGroup:
        subnetGroupName === undefined
          ? undefined
          : withValues<InstanceSubnetGroup>(
              {
                name: subnetGroupName,
                subnets: (raw.DBSubnetGroup?.Subnets ?? []).flatMap((subnet) => {
                  const subnetId = text(subnet.SubnetIdentifier);
                  return subnetId === undefined ? [] : [subnetId];
                }),
              },
              { vpcId: text(raw.DBSubnetGroup?.VpcId) },
            ),
    },
  );
}

/** The DB instances of an answer, in its order. */
export function instancesOf(raw: readonly SdkInstance[] | undefined): DbInstance[] {
  return (raw ?? []).flatMap((entry) => {
    const instance = instanceOf(entry);
    return instance === undefined ? [] : [instance];
  });
}

/** One page of `DescribeDBInstances`: its DB instances in the answer's order, and its marker. */
export interface InstancePage {
  instances: DbInstance[];
  marker?: string;
}

/**
 * One page of `DescribeDBInstances` with `MaxRecords` `size`, the `Marker` when given and the filters when given.
 * S1 asks 50 a page; a cluster's members are asked with its filter (`cluster-api.ts`).
 */
export async function describeInstances(
  endpoint: string,
  options: { size: number; marker?: string | undefined; filters?: Filter[] },
  signal: AbortSignal,
): Promise<InstancePage> {
  const output = await sendRds(
    endpoint,
    OPERATIONS.describeDBInstances,
    (client, abortSignal) =>
      client.send(
        new DescribeDBInstancesCommand({
          MaxRecords: options.size,
          ...(options.marker === undefined ? {} : { Marker: options.marker }),
          ...(options.filters === undefined ? {} : { Filters: options.filters }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: InstancePage = { instances: instancesOf(output.DBInstances) };
  const next = text(output.Marker);
  if (next !== undefined) {
    page.marker = next;
  }
  return page;
}

/** S1's page: `DescribeDBInstances` with `MaxRecords` 50 and the page's marker when it has one. */
export function listInstances(endpoint: string, marker: string | undefined, signal: AbortSignal): Promise<InstancePage> {
  return describeInstances(endpoint, { size: INSTANCES_PAGE_SIZE, marker }, signal);
}

/** A DB instance read: the instance, or "not found" (404 `DBInstanceNotFound`). */
export type InstanceRead = { found: true; instance: DbInstance } | { found: false };

/** S3's read: `DescribeDBInstances` by `DBInstanceIdentifier`; `DBInstanceNotFound` is a result, not a failure. */
export async function getInstance(endpoint: string, id: string, signal: AbortSignal): Promise<InstanceRead> {
  try {
    const output = await sendRds(
      endpoint,
      OPERATIONS.describeDBInstances,
      (client, abortSignal) =>
        client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }), { abortSignal }),
      signal,
    );
    const [instance] = instancesOf(output.DBInstances);
    return instance === undefined ? { found: false } : { found: true, instance };
  } catch (error) {
    if (isCode(error, INSTANCE_NOT_FOUND)) {
      return { found: false };
    }
    throw error;
  }
}

/** The operation each action sends. */
export const ACTION_OPERATIONS: Readonly<Record<InstanceAction, string>> = {
  start: OPERATIONS.startDBInstance,
  stop: OPERATIONS.stopDBInstance,
  reboot: OPERATIONS.rebootDBInstance,
  delete: OPERATIONS.deleteDBInstance,
};

/** "Start", "Stop", "Reboot" or "Delete" of the one DB instance `id`; a delete with no final snapshot. */
export async function actOnInstance(
  endpoint: string,
  action: InstanceAction,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  const input = { DBInstanceIdentifier: id };
  await sendRds(
    endpoint,
    ACTION_OPERATIONS[action],
    (client, abortSignal) => {
      switch (action) {
        case 'start':
          return client.send(new StartDBInstanceCommand(input), { abortSignal });
        case 'stop':
          return client.send(new StopDBInstanceCommand(input), { abortSignal });
        case 'reboot':
          return client.send(new RebootDBInstanceCommand(input), { abortSignal });
        case 'delete':
          return client.send(new DeleteDBInstanceCommand({ ...input, SkipFinalSnapshot: true }), { abortSignal });
      }
    },
    signal,
  );
}
