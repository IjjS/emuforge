import {
  CreateDBClusterSnapshotCommand,
  DeleteDBClusterSnapshotCommand,
  DescribeDBClusterSnapshotsCommand,
  RestoreDBClusterFromSnapshotCommand,
} from '@aws-sdk/client-rds';

import type { TagRow } from '../../lib/tag-rows';
import { sendRds, text, withValues } from './api';

export const SNAPSHOT_OPERATIONS = {
  list: 'DescribeDBClusterSnapshots',
  create: 'CreateDBClusterSnapshot',
  restore: 'RestoreDBClusterFromSnapshot',
  delete: 'DeleteDBClusterSnapshot',
} as const;

export interface ClusterSnapshot {
  id: string;
  sourceId?: string;
  engine?: string;
  status: string;
}

export async function listClusterSnapshots(endpoint: string, marker: string | undefined, signal: AbortSignal) {
  const output = await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.list,
    (client, abortSignal) =>
      client.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: 'manual', MaxRecords: 20, Marker: marker }), {
        abortSignal,
      }),
    signal,
  );
  const items = (output.DBClusterSnapshots ?? []).flatMap((snapshot) => {
    const id = text(snapshot.DBClusterSnapshotIdentifier);
    return id === undefined
      ? []
      : [
          withValues<ClusterSnapshot>(
            { id, status: text(snapshot.Status) ?? '' },
            { sourceId: text(snapshot.DBClusterIdentifier), engine: text(snapshot.Engine) },
          ),
        ];
  });
  const next = text(output.Marker);
  return next === undefined ? { items } : { items, next };
}

function optionalTags(tags: readonly TagRow[] = []) {
  return tags.length === 0 ? {} : { Tags: tags.map(({ key, value }) => ({ Key: key, Value: value })) };
}

export async function createClusterSnapshot(
  endpoint: string,
  sourceId: string,
  id: string,
  signal: AbortSignal,
  tags: readonly TagRow[] = [],
) {
  const output = await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.create,
    (client, abortSignal) =>
      client.send(
        new CreateDBClusterSnapshotCommand({
          DBClusterIdentifier: sourceId,
          DBClusterSnapshotIdentifier: id,
          ...optionalTags(tags),
        }),
        {
          abortSignal,
        },
      ),
    signal,
  );
  return text(output.DBClusterSnapshot?.DBClusterSnapshotIdentifier) ?? id;
}

export interface SnapshotRestore {
  identifier: string;
  subnetGroupName?: string | undefined;
  securityGroupIds?: readonly string[];
  zones?: readonly string[];
  kmsKeyArn?: string | undefined;
  deletionProtection?: boolean;
  tags?: readonly TagRow[];
}

export async function restoreClusterSnapshot(
  endpoint: string,
  snapshotId: string,
  engine: string,
  values: SnapshotRestore,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.restore,
    (client, abortSignal) =>
      client.send(
        new RestoreDBClusterFromSnapshotCommand({
          DBClusterIdentifier: values.identifier,
          SnapshotIdentifier: snapshotId,
          Engine: engine,
          ...(values.subnetGroupName === undefined ? {} : { DBSubnetGroupName: values.subnetGroupName }),
          ...(values.securityGroupIds?.length ? { VpcSecurityGroupIds: [...values.securityGroupIds] } : {}),
          ...(values.zones?.length ? { AvailabilityZones: [...values.zones] } : {}),
          ...(values.kmsKeyArn === undefined ? {} : { KmsKeyId: values.kmsKeyArn }),
          ...(values.deletionProtection === undefined ? {} : { DeletionProtection: values.deletionProtection }),
          ...optionalTags(values.tags),
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.DBCluster?.DBClusterIdentifier) ?? values.identifier;
}

export async function deleteClusterSnapshot(endpoint: string, id: string, signal: AbortSignal) {
  await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.delete,
    (client, abortSignal) =>
      client.send(new DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: id }), { abortSignal }),
    signal,
  );
}
