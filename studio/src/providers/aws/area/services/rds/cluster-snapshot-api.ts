import {
  CreateDBClusterSnapshotCommand,
  DeleteDBClusterSnapshotCommand,
  DescribeDBClusterSnapshotsCommand,
  RestoreDBClusterFromSnapshotCommand,
} from '@aws-sdk/client-rds';

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

export async function createClusterSnapshot(endpoint: string, sourceId: string, id: string, signal: AbortSignal) {
  await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.create,
    (client, abortSignal) =>
      client.send(
        new CreateDBClusterSnapshotCommand({ DBClusterIdentifier: sourceId, DBClusterSnapshotIdentifier: id }),
        {
          abortSignal,
        },
      ),
    signal,
  );
}

export async function restoreClusterSnapshot(
  endpoint: string,
  snapshotId: string,
  engine: string,
  clusterId: string,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendRds(
    endpoint,
    SNAPSHOT_OPERATIONS.restore,
    (client, abortSignal) =>
      client.send(
        new RestoreDBClusterFromSnapshotCommand({
          DBClusterIdentifier: clusterId,
          SnapshotIdentifier: snapshotId,
          Engine: engine,
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.DBCluster?.DBClusterIdentifier) ?? clusterId;
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
