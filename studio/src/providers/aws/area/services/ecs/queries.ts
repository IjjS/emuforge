import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  createCluster,
  deleteCluster,
  getCluster,
  listClusters,
  OPERATIONS,
  type Cluster,
  type ClusterRead,
} from './api';

// The TanStack Query hooks of ECS's cluster screens, and the roots of every key of ECS's reads (issue 575, design
// "Keys"), so a change of one unit reads again, by a root, what another unit shows, never by importing that unit's
// file. Every read is a request of its own on every mount, "Refresh" and "Retry", under a key that holds every filter
// and token; a read no longer wanted is aborted, and its late answer, under a key nobody shows any more, changes
// nothing shown.

/** The start of every key of ECS's reads. */
export const ECS_KEY = ['aws', 'ecs'] as const;

/**
 * The roots of ECS's keys, each a prefix of the reads it names: with its parts given, the key of one read; with
 * fewer, of every read below it, which is what a change reads again. No root is under another.
 */
export const ECS_KEYS = {
  /** S1's pages, each by its token. */
  clusters: (...parts: unknown[]) => [...ECS_KEY, 'clusters', ...parts],
  /** The reads of the one cluster `cluster` (S3 to S6's gate). */
  cluster: (cluster: string, ...parts: unknown[]) => [...ECS_KEY, 'cluster', cluster, ...parts],
  /** Every read of the tasks of the cluster `cluster`: its tables, by filter and token, and each task (s2). */
  clusterTasks: (cluster: string, ...parts: unknown[]) => [...ECS_KEY, 'cluster-tasks', cluster, ...parts],
  /** Every read of the services of the cluster `cluster`: its table, by token, and each service (s5, s6). */
  clusterServices: (cluster: string, ...parts: unknown[]) => [...ECS_KEY, 'cluster-services', cluster, ...parts],
  /** S7's pages of the families, by prefix and token (s4). */
  families: (...parts: unknown[]) => [...ECS_KEY, 'families', ...parts],
  /** S8's pages of the revisions of the family `family`, by status and token (s4). */
  familyRevisions: (family: string, ...parts: unknown[]) => [...ECS_KEY, 'family-revisions', family, ...parts],
  /** S9's read of the revision `revision` of the family `family` (s4). */
  revision: (family: string, revision: number, ...parts: unknown[]) => [
    ...ECS_KEY,
    'revision',
    family,
    revision,
    ...parts,
  ],
};

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** S1: the clusters, a page of `ListClusters` and `DescribeClusters` at a time on the API's own tokens. */
export function useClusterListing(endpoint: string | undefined): TokenListing<Cluster> {
  return useTokenListing({
    key: ECS_KEYS.clusters(),
    endpoint,
    operation: OPERATIONS.listClusters,
    read: async (at, token, signal) => {
      const page = await listClusters(at, token, signal);
      return page.nextToken === undefined ? { items: page.clusters } : { items: page.clusters, next: page.nextToken };
    },
  });
}

/** One read as a screen shows it. */
export interface EcsRead<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** The read is in flight with nothing of it shown, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

/** The read of the cluster `cluster`: the active cluster, or "not found" (`MISSING` or `INACTIVE`). */
export function useCluster(endpoint: string | undefined, cluster: string): EcsRead<ClusterRead> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...ECS_KEYS.cluster(cluster), endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getCluster(endpoint, cluster, signal)),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, OPERATIONS.describeClusters) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}

/** What "Create cluster" came to: the cluster was created, or one of that name is already active and none was sent. */
export type CreateOutcome = 'created' | 'exists';

/**
 * "Create cluster" of `name`: first the read of that cluster, awaited (no query, so nothing is held of it); an active
 * cluster of the name stops there, since the emulator would answer it as if it had created it. Otherwise
 * `CreateCluster`; once it succeeds the clusters list is read again, and a read of that cluster that is out is
 * cancelled and what is held of it removed, so its page opens with nothing of before. A refusal changes nothing held.
 */
export function useCreateCluster(
  endpoint: string | undefined,
): (name: string, signal: AbortSignal) => Promise<CreateOutcome> {
  const client = useQueryClient();
  return useCallback(
    async (name: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const read = await getCluster(endpoint, name, signal);
      if (read.found) {
        return 'exists';
      }
      await createCluster(endpoint, name, signal);
      await client.cancelQueries({ queryKey: ECS_KEYS.cluster(name) });
      client.removeQueries({ queryKey: ECS_KEYS.cluster(name) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusters() });
      return 'created';
    },
    [endpoint, client],
  );
}

/** "Delete cluster" of `name`. Once it succeeds the clusters list and that cluster's reads are read again. */
export function useDeleteCluster(endpoint: string | undefined): (name: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (name: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteCluster(endpoint, name, signal);
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusters() });
      void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(name) });
    },
    [endpoint, client],
  );
}
