import {
  CreateDBInstanceCommand,
  DeleteDBClusterCommand,
  DescribeDBClustersCommand,
  FailoverDBClusterCommand,
  ModifyDBClusterCommand,
  StartDBClusterCommand,
  StopDBClusterCommand,
  type DBCluster as SdkCluster,
} from '@aws-sdk/client-rds';

import { dateOf, describeInstances, isCode, sendRds, tagsOf, text, withValues, type DbInstance } from './api';
import { CLUSTER_ACTIONS, type ClusterOperation } from './cluster-operations';
import type { Tag } from './format';

// The calls of RDS's DB cluster screens (issue 573, design task 4), sent through `sendRds` of `api.ts` and mapped to
// plain typed results: the clusters page, one cluster, its members, the delete of a cluster and the add of a DB
// instance to it and cluster operations. Every value is the emulator's, as it came.

/** The operations of the DB cluster screens, as a failure names them. */
export const CLUSTER_OPERATIONS = {
  describeDBClusters: 'DescribeDBClusters',
  deleteDBCluster: 'DeleteDBCluster',
  createDBInstance: 'CreateDBInstance',
} as const;

/** How many DB clusters one page of S4 asks for. */
export const CLUSTERS_PAGE_SIZE = 50;

/** How many members S6 asks for: one answer holds them all, the emulator's quota being 40 DB instances. */
export const MEMBERS_PAGE_SIZE = 100;

/** RDS's answer for a DB cluster it does not hold. */
const CLUSTER_NOT_FOUND = 'DBClusterNotFoundFault';

/** A DB instance a DB cluster names as its member. */
export interface ClusterMember {
  id: string;
  /** The cluster's `IsClusterWriter` for it. */
  writer: boolean;
}

/** A DB cluster as S4, S6 and S7 show it. A value the answer lacks is absent. */
export interface DbCluster {
  id: string;
  /** `Status` as the API names it; empty when the answer gave none. */
  status: string;
  engine?: string;
  engineVersion?: string;
  port?: number;
  createdAt?: Date;
  /** The writer endpoint, `Endpoint`. */
  endpoint?: string;
  readerEndpoint?: string;
  masterUsername?: string;
  databaseName?: string;
  arn?: string;
  resourceId?: string;
  subnetGroup?: string;
  securityGroups: string[];
  parameterGroup?: string;
  /** The cluster's `DBClusterMembers`, in the answer's order. */
  members: ClusterMember[];
  deletionProtection: boolean;
  backupRetentionPeriod?: number;
  tags: Tag[];
}

function portOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A DB cluster of an answer; `undefined` without an identifier. */
export function clusterOf(raw: SdkCluster): DbCluster | undefined {
  const id = text(raw.DBClusterIdentifier);
  if (id === undefined) {
    return undefined;
  }
  return withValues<DbCluster>(
    {
      id,
      status: text(raw.Status) ?? '',
      securityGroups: (raw.VpcSecurityGroups ?? []).flatMap((group) => {
        const groupId = text(group.VpcSecurityGroupId);
        return groupId === undefined ? [] : [groupId];
      }),
      members: (raw.DBClusterMembers ?? []).flatMap((member) => {
        const memberId = text(member.DBInstanceIdentifier);
        return memberId === undefined ? [] : [{ id: memberId, writer: member.IsClusterWriter === true }];
      }),
      deletionProtection: raw.DeletionProtection === true,
      tags: tagsOf(raw.TagList),
    },
    {
      engine: text(raw.Engine),
      engineVersion: text(raw.EngineVersion),
      port: portOf(raw.Port),
      backupRetentionPeriod: portOf(raw.BackupRetentionPeriod),
      createdAt: dateOf(raw.ClusterCreateTime),
      endpoint: text(raw.Endpoint),
      readerEndpoint: text(raw.ReaderEndpoint),
      masterUsername: text(raw.MasterUsername),
      databaseName: text(raw.DatabaseName),
      arn: text(raw.DBClusterArn),
      resourceId: text(raw.DbClusterResourceId),
      subnetGroup: text(raw.DBSubnetGroup),
      parameterGroup: text(raw.DBClusterParameterGroup),
    },
  );
}

function clustersOf(raw: readonly SdkCluster[] | undefined): DbCluster[] {
  return (raw ?? []).flatMap((entry) => {
    const cluster = clusterOf(entry);
    return cluster === undefined ? [] : [cluster];
  });
}

/** One page of `DescribeDBClusters`: its DB clusters in the answer's order, and its marker. */
export interface ClusterPage {
  clusters: DbCluster[];
  marker?: string;
}

/** S4's page: `DescribeDBClusters` with `MaxRecords` 50 and the page's marker when it has one. */
export async function listClusters(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<ClusterPage> {
  const output = await sendRds(
    endpoint,
    CLUSTER_OPERATIONS.describeDBClusters,
    (client, abortSignal) =>
      client.send(
        new DescribeDBClustersCommand({
          MaxRecords: CLUSTERS_PAGE_SIZE,
          ...(marker === undefined ? {} : { Marker: marker }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: ClusterPage = { clusters: clustersOf(output.DBClusters) };
  const next = text(output.Marker);
  if (next !== undefined) {
    page.marker = next;
  }
  return page;
}

/** A DB cluster read: the cluster, or "not found" (404 `DBClusterNotFoundFault`). */
export type ClusterRead = { found: true; cluster: DbCluster } | { found: false };

/** S6's and S7's read: `DescribeDBClusters` by `DBClusterIdentifier`; "not found" is a result, not a failure. */
export async function getCluster(endpoint: string, id: string, signal: AbortSignal): Promise<ClusterRead> {
  try {
    const output = await sendRds(
      endpoint,
      CLUSTER_OPERATIONS.describeDBClusters,
      (client, abortSignal) => client.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id }), { abortSignal }),
      signal,
    );
    const [cluster] = clustersOf(output.DBClusters);
    return cluster === undefined ? { found: false } : { found: true, cluster };
  } catch (error) {
    if (isCode(error, CLUSTER_NOT_FOUND)) {
      return { found: false };
    }
    throw error;
  }
}

/** S6's members: `DescribeDBInstances` with the filter `db-cluster-id` and `MaxRecords` 100, each as S1 maps it. */
export async function listMembers(endpoint: string, clusterId: string, signal: AbortSignal): Promise<DbInstance[]> {
  const page = await describeInstances(
    endpoint,
    { size: MEMBERS_PAGE_SIZE, filters: [{ Name: 'db-cluster-id', Values: [clusterId] }] },
    signal,
  );
  return page.instances;
}

/** "Delete" of the DB cluster `id`, with no final snapshot. */
export async function deleteCluster(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendRds(
    endpoint,
    CLUSTER_OPERATIONS.deleteDBCluster,
    (client, abortSignal) =>
      client.send(new DeleteDBClusterCommand({ DBClusterIdentifier: id, SkipFinalSnapshot: true }), { abortSignal }),
    signal,
  );
}

/** What S7 adds: the identifier and the class typed, the cluster's identifier, engine and version as read. */
export interface NewMember {
  id: string;
  clusterId: string;
  engine: string | undefined;
  engineVersion: string | undefined;
  instanceClass: string;
}

/**
 * "Add DB instance": one `CreateDBInstance` with the identifier, the cluster's identifier, its engine, its version
 * (a member does not take it otherwise) and the class, and nothing else. Answers the identifier the emulator gave.
 */
export async function addInstance(endpoint: string, member: NewMember, signal: AbortSignal): Promise<string> {
  const output = await sendRds(
    endpoint,
    CLUSTER_OPERATIONS.createDBInstance,
    (client, abortSignal) =>
      client.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: member.id,
          DBClusterIdentifier: member.clusterId,
          Engine: member.engine,
          ...(member.engineVersion === undefined ? {} : { EngineVersion: member.engineVersion }),
          DBInstanceClass: member.instanceClass,
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.DBInstance?.DBInstanceIdentifier) ?? member.id.toLowerCase();
}

/** Submit a cluster operation. The detail and members are read separately after acceptance. */
export async function operateCluster(
  endpoint: string,
  id: string,
  action: ClusterOperation,
  signal: AbortSignal,
): Promise<void> {
  const input = { DBClusterIdentifier: id };
  await sendRds(
    endpoint,
    CLUSTER_ACTIONS[action.kind].operation,
    async (client, abortSignal): Promise<void> => {
      const options = { abortSignal };
      switch (action.kind) {
        case 'stop':
          await client.send(new StopDBClusterCommand(input), options);
          break;
        case 'start':
          await client.send(new StartDBClusterCommand(input), options);
          break;
        case 'modify': {
          const { deletionProtection, backupRetentionPeriod } = action.changes;
          await client.send(
            new ModifyDBClusterCommand({
              ...input,
              ApplyImmediately: true,
              ...(deletionProtection === undefined ? {} : { DeletionProtection: deletionProtection }),
              ...(backupRetentionPeriod === undefined ? {} : { BackupRetentionPeriod: backupRetentionPeriod }),
            }),
            options,
          );
          break;
        }
        case 'failover':
          await client.send(
            new FailoverDBClusterCommand({ ...input, TargetDBInstanceIdentifier: action.target }),
            options,
          );
          break;
      }
    },
    signal,
  );
}
