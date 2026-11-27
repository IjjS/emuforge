import { useQueryClient } from '@tanstack/react-query';

import { noEndpoint, useTokenListing } from '../../components/use-token-listing';
import type { TagRow } from '../../lib/tag-rows';
import {
  createClusterSnapshot,
  deleteClusterSnapshot,
  listClusterSnapshots,
  restoreClusterSnapshot,
  SNAPSHOT_OPERATIONS,
  type SnapshotRestore,
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
    async create(sourceId: string, id: string, tags: readonly TagRow[], signal: AbortSignal) {
      const at = endpoint ?? noEndpoint();
      const createdId =
        tags.length === 0
          ? await createClusterSnapshot(at, sourceId, id, signal)
          : await createClusterSnapshot(at, sourceId, id, signal, tags);
      await refreshSnapshots();
      return createdId;
    },
    async restore(snapshotId: string, engine: string, values: SnapshotRestore, signal: AbortSignal) {
      const id = await restoreClusterSnapshot(endpoint ?? noEndpoint(), snapshotId, engine, values, signal);
      const filters = [RDS_KEYS.clusters(), RDS_KEYS.cluster(id), RDS_KEYS.members(id)].map((queryKey) => ({
        queryKey,
      }));
      await Promise.all(filters.map((filter) => client.cancelQueries(filter)));
      for (const filter of filters) void client.invalidateQueries(filter);
      return id;
    },
    async remove(id: string, signal: AbortSignal) {
      await deleteClusterSnapshot(endpoint ?? noEndpoint(), id, signal);
      await refreshSnapshots();
    },
  };
}
