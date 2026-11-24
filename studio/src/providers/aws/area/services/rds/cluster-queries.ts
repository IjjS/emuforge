import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import { OPERATIONS, type DbInstance } from './api';
import {
  addInstance,
  CLUSTER_OPERATIONS,
  deleteCluster,
  getCluster,
  listClusters,
  listMembers,
  operateCluster,
  type ClusterRead,
  type DbCluster,
  type NewMember,
} from './cluster-api';
import type { ClusterOperation } from './cluster-operations';
import { RDS_KEYS, useRdsRead, type RdsRead } from './queries';
import { isInProgress, READ_AGAIN_MS } from './status';

// The TanStack Query hooks of RDS's DB cluster screens (issue 573, design task 4), on the keys of `queries.ts`. Every
// read is a request of its own on every mount, "Refresh" and "Retry"; a read no longer wanted is aborted, and its
// late answer changes nothing shown. S6 reads its cluster and its members in one round, so a member's role is the
// cluster's of the same round, and reads that round again every 3 seconds while the cluster or a member moves.

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/**
 * S4: the DB clusters, a page of `DescribeDBClusters` at a time on the API's markers. While a row is in one of the
 * statuses in progress the page is read again every 3 seconds with the same marker.
 */
export function useClusterListing(endpoint: string | undefined): TokenListing<DbCluster> {
  return useTokenListing({
    key: RDS_KEYS.clusters(),
    endpoint,
    operation: CLUSTER_OPERATIONS.describeDBClusters,
    read: async (at, marker, signal) => {
      const page = await listClusters(at, marker, signal);
      return page.marker === undefined ? { items: page.clusters } : { items: page.clusters, next: page.marker };
    },
    readAgainAfter: (clusters) => (clusters.some((cluster) => isInProgress(cluster.status)) ? READ_AGAIN_MS : false),
  });
}

/** S7's read of the DB cluster `id`, once: the form needs its engine and version. */
export function useClusterOnce(endpoint: string | undefined, id: string): RdsRead<ClusterRead> {
  return useRdsRead({
    key: RDS_KEYS.cluster(id, 'once'),
    endpoint,
    operation: CLUSTER_OPERATIONS.describeDBClusters,
    read: (at, signal) => getCluster(at, id, signal),
  });
}

/** The members' read of a round: its DB instances, or why it failed, which fails S6's "DB instances" alone. */
export type MembersRead = { ok: true; instances: DbInstance[] } | { ok: false; failure: RequestFailure };

/** One round of S6: the cluster, and, when it is held, its members. */
export interface ClusterRound {
  cluster: ClusterRead;
  members: MembersRead | undefined;
}

/** S6's reads as the page shows them. */
export interface ClusterReading extends RdsRead<ClusterRound> {
  /** The round is read again with what it shows kept (the members' "Retry"). */
  fetching: boolean;
  /** Reads the round again, keeping what is shown until it answers. */
  retryMembers: () => void;
}

function roundMoves(round: ClusterRound): boolean {
  if (!round.cluster.found) {
    return false;
  }
  if (isInProgress(round.cluster.cluster.status)) {
    return true;
  }
  return round.members?.ok === true && round.members.instances.some((instance) => isInProgress(instance.status));
}

async function readRound(endpoint: string, id: string, signal: AbortSignal): Promise<ClusterRound> {
  const members = listMembers(endpoint, id, signal).then(
    (instances): MembersRead => ({ ok: true, instances }),
    (error: unknown): MembersRead => ({ ok: false, failure: failureOf(error, OPERATIONS.describeDBInstances) }),
  );
  const cluster = await getCluster(endpoint, id, signal);
  const membersRead = await members;
  if (signal.aborted) {
    throw signal.reason;
  }
  return { cluster, members: cluster.found ? membersRead : undefined };
}

/**
 * S6: the DB cluster `id` and its members, both asked at once and shown together. A failed read of the cluster fails
 * the page; a failed read of the members only their section. Read again every 3 seconds while the cluster or a member
 * is in in progress, and after a change that reads the cluster again (its key names this read).
 */
export function useClusterRound(endpoint: string | undefined, id: string): ClusterReading {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...RDS_KEYS.cluster(id, 'round'), endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : readRound(endpoint, id, signal)),
    enabled: endpoint !== undefined,
    refetchInterval: (current) => {
      const value = current.state.data;
      return value === undefined || current.state.status === 'error' || !roundMoves(value) ? false : READ_AGAIN_MS;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const retryMembers = useCallback(() => {
    void refetch();
  }, [refetch]);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, CLUSTER_OPERATIONS.describeDBClusters) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
    fetching: query.isFetching,
    retryMembers,
  };
}

/**
 * "Delete" of one DB cluster, as the page that holds it sends it. Once it is answered, 200 or a failure, the cluster
 * lists and that cluster are read again.
 */
export function useClusterDelete(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      try {
        await deleteCluster(endpoint, id, signal);
      } finally {
        for (const queryKey of [RDS_KEYS.clusters(), RDS_KEYS.cluster(id)]) {
          void client.invalidateQueries({ queryKey });
        }
      }
    },
    [endpoint, client],
  );
}

/**
 * "Add DB instance" to a DB cluster. Once it is answered 200, that cluster, its members and the instance lists are
 * read again; a refusal changes nothing, so nothing is. Answers the new instance's identifier.
 */
export function useAddInstance(
  endpoint: string | undefined,
): (member: NewMember, signal: AbortSignal) => Promise<string> {
  const client = useQueryClient();
  return useCallback(
    async (member: NewMember, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await addInstance(endpoint, member, signal);
      for (const queryKey of [
        RDS_KEYS.cluster(member.clusterId),
        RDS_KEYS.members(member.clusterId),
        RDS_KEYS.instances(),
      ]) {
        void client.invalidateQueries({ queryKey });
      }
      return id;
    },
    [endpoint, client],
  );
}

/** Re-read the cluster and its instances after the emulator accepts a change. */
export function useClusterOperation(endpoint: string | undefined) {
  const client = useQueryClient();
  return useCallback(
    async (id: string, action: ClusterOperation, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await operateCluster(endpoint, id, action, signal);
      const detail = { queryKey: RDS_KEYS.cluster(id) };
      // A read already in flight may have started before the operation was accepted.
      await client.cancelQueries(detail);
      for (const queryKey of [detail.queryKey, RDS_KEYS.clusters(), RDS_KEYS.instances()]) {
        void client.invalidateQueries({ queryKey });
      }
    },
    [client, endpoint],
  );
}
