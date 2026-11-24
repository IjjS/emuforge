import { useQueryClient } from '@tanstack/react-query';

import { noEndpoint, useTokenListing } from '../../components/use-token-listing';
import {
  createClusterSnapshot,
  deleteClusterSnapshot,
  listClusterSnapshots,
  restoreClusterSnapshot,
  SNAPSHOT_OPERATIONS,
} from './cluster-snapshot-api';
import { RDS_KEY, RDS_KEYS } from './queries';
import { isInProgress, READ_AGAIN_MS } from './status';

const SNAPSHOT_KEY = [...RDS_KEY, 'cluster-snapshots'] as const;

export function useClusterSnapshotListing(endpoint: string | undefined) {
  return useTokenListing({
    key: [...SNAPSHOT_KEY, 'manual'],
    endpoint,
    operation: SNAPSHOT_OPERATIONS.list,
    read: listClusterSnapshots,
    readAgainAfter: (items) => (items.some((snapshot) => isInProgress(snapshot.status)) ? READ_AGAIN_MS : false),
  });
}

export function useClusterSnapshotActions(endpoint: string | undefined) {
  const client = useQueryClient();
  const refreshSnapshots = async () => {
    const filters = { queryKey: SNAPSHOT_KEY };
    // Discard any list read that started before the write was accepted.
    await client.cancelQueries(filters);
    void client.invalidateQueries(filters);
  };

  return {
    async create(sourceId: string, id: string, signal: AbortSignal) {
      await createClusterSnapshot(endpoint ?? noEndpoint(), sourceId, id, signal);
      await refreshSnapshots();
    },
    async restore(snapshotId: string, engine: string, clusterId: string, signal: AbortSignal) {
      const id = await restoreClusterSnapshot(endpoint ?? noEndpoint(), snapshotId, engine, clusterId, signal);
      for (const queryKey of [RDS_KEYS.clusters(), RDS_KEYS.cluster(id)]) {
        void client.invalidateQueries({ queryKey });
      }
      return id;
    },
    async remove(id: string, signal: AbortSignal) {
      await deleteClusterSnapshot(endpoint ?? noEndpoint(), id, signal);
      await refreshSnapshots();
    },
  };
}
