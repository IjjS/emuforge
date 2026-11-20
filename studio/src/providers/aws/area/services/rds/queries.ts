import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  actOnInstance,
  getClusterSignIn,
  getInstance,
  listInstances,
  OPERATIONS,
  type ClusterSignIn,
  type DbInstance,
  type InstanceRead,
} from './api';
import { modifyInstance, type InstanceChanges } from './modify-api';
import { isInProgress, READ_AGAIN_MS, type InstanceAction } from './status';

// The TanStack Query hooks of RDS's DB instance screens, and the query keys of every resource of RDS (issue 573,
// design "Code layout and the cut"), so an action of one unit reads again what another unit shows. Every read is a
// request of its own on every mount, "Refresh" and "Retry", under a key that holds every marker; a read no longer
// wanted is aborted, and its late answer, under a key nobody shows any more, changes nothing shown. While a DB
// instance shown is in one of the six statuses in progress its read is made again every 3 seconds, in place.

/** The start of every key of RDS's reads. */
export const RDS_KEY = ['aws', 'rds'] as const;

/**
 * The keys of RDS's reads, each a prefix of the reads it names: with its parts given, the key of one read; with fewer,
 * of every read of the resource it starts, which is what a mutation reads again.
 */
export const RDS_KEYS = {
  /** S1's lists. */
  instances: (...parts: unknown[]) => [...RDS_KEY, 'instances', ...parts],
  /** S3's reads of one DB instance; with no identifier, of every one. */
  instance: (id?: string, ...parts: unknown[]) =>
    id === undefined ? [...RDS_KEY, 'instance'] : [...RDS_KEY, 'instance', id, ...parts],
  /** S4's lists. */
  clusters: (...parts: unknown[]) => [...RDS_KEY, 'clusters', ...parts],
  /** S6's and S7's reads of one DB cluster; with no identifier, of every one. */
  cluster: (id?: string, ...parts: unknown[]) =>
    id === undefined ? [...RDS_KEY, 'cluster'] : [...RDS_KEY, 'cluster', id, ...parts],
  /** S6's DB instances of one DB cluster; with no identifier, of every cluster. */
  members: (clusterId?: string, ...parts: unknown[]) =>
    clusterId === undefined ? [...RDS_KEY, 'members'] : [...RDS_KEY, 'members', clusterId, ...parts],
  /** A form's choices, by what they are of ("engine-versions", "subnet-groups", …) and filter. */
  choices: (of?: string, ...filters: unknown[]) =>
    of === undefined ? [...RDS_KEY, 'choices'] : [...RDS_KEY, 'choices', of, ...filters],
};

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

function anyInProgress(instances: readonly DbInstance[]): number | false {
  return instances.some((instance) => isInProgress(instance.status)) ? READ_AGAIN_MS : false;
}

/**
 * S1: the DB instances, a page of `DescribeDBInstances` at a time on the API's markers. While a row is in one of the
 * six statuses in progress the page is read again every 3 seconds with the same marker.
 */
export function useInstanceListing(endpoint: string | undefined): TokenListing<DbInstance> {
  return useTokenListing({
    key: RDS_KEYS.instances(),
    endpoint,
    operation: OPERATIONS.describeDBInstances,
    read: async (at, marker, signal) => {
      const page = await listInstances(at, marker, signal);
      return page.marker === undefined ? { items: page.instances } : { items: page.instances, next: page.marker };
    },
    readAgainAfter: anyInProgress,
  });
}

/** One read as a screen shows it. */
export interface RdsRead<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** The read is in flight with nothing of it shown, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

export interface ReadOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  operation: string;
  read: (endpoint: string, signal: AbortSignal) => Promise<T>;
  readAgainAfter?: (value: T) => number | false;
  /** Whether it reads at all; a read that does not stays loading with nothing shown. */
  enabled?: boolean;
}

/** One read of a page of RDS, as S3, S6 and S7 make theirs. */
export function useRdsRead<T>({
  key,
  endpoint,
  operation,
  read,
  readAgainAfter,
  enabled = true,
}: ReadOptions<T>): RdsRead<T> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...key, endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : read(endpoint, signal)),
    enabled: enabled && endpoint !== undefined,
    refetchInterval: (current) => {
      const value = current.state.data;
      return readAgainAfter === undefined || value === undefined || current.state.status === 'error'
        ? false
        : readAgainAfter(value);
    },
    refetchIntervalInBackground: true,
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
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}

/** S3's read of the DB instance `id`, made again every 3 seconds while its status is in progress. */
export function useInstance(endpoint: string | undefined, id: string): RdsRead<InstanceRead> {
  return useRdsRead({
    key: RDS_KEYS.instance(id),
    endpoint,
    operation: OPERATIONS.describeDBInstances,
    read: (at, signal) => getInstance(at, id, signal),
    readAgainAfter: (read) => (read.found && isInProgress(read.instance.status) ? READ_AGAIN_MS : false),
  });
}

/**
 * S3's read of a member's DB cluster, for the sign-in values the member has none of its own; none is read while
 * `clusterId` is not given.
 */
export function useClusterSignIn(endpoint: string | undefined, clusterId: string | undefined): RdsRead<ClusterSignIn> {
  return useRdsRead({
    key: RDS_KEYS.cluster(clusterId ?? '', 'sign-in'),
    endpoint,
    operation: OPERATIONS.describeDBClusters,
    read: (at, signal) => (clusterId === undefined ? Promise.resolve({}) : getClusterSignIn(at, clusterId, signal)),
    enabled: clusterId !== undefined,
  });
}

/**
 * "Start", "Stop", "Reboot", "Delete" of one DB instance, as the page that holds it sends it. Once it is answered, 200
 * or a failure, the instance lists and that instance are read again, and so is everything the folder holds of DB
 * clusters: a member's change or delete changes its cluster's.
 */
export function useInstanceAction(
  endpoint: string | undefined,
): (action: InstanceAction, id: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (action: InstanceAction, id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      try {
        await actOnInstance(endpoint, action, id, signal);
      } finally {
        for (const queryKey of [
          RDS_KEYS.instances(),
          RDS_KEYS.instance(id),
          RDS_KEYS.clusters(),
          RDS_KEYS.cluster(),
          RDS_KEYS.members(),
        ]) {
          void client.invalidateQueries({ queryKey });
        }
      }
    },
    [endpoint, client],
  );
}

/** Invalidate affected reads independently of navigation and the modification result. */
export function useModifyInstance(endpoint: string | undefined) {
  const client = useQueryClient();
  return useCallback(
    async (instance: DbInstance, changes: InstanceChanges, signal: AbortSignal): Promise<string> => {
      if (endpoint === undefined) noEndpoint();
      const id = await modifyInstance(endpoint, instance.id, changes, signal);
      signal.throwIfAborted();
      const keys = [RDS_KEYS.instances()];
      if (id === instance.id) {
        // The detail page opens a new read generation after acceptance.
        void client.invalidateQueries({ queryKey: RDS_KEYS.instance(id), refetchType: 'none' });
      } else {
        keys.push(RDS_KEYS.instance(instance.id), RDS_KEYS.instance(id));
      }
      if (instance.clusterId !== undefined) {
        keys.push(RDS_KEYS.cluster(instance.clusterId), RDS_KEYS.members(instance.clusterId));
      }
      for (const queryKey of keys) {
        void client.invalidateQueries({ queryKey });
      }
      return id;
    },
    [endpoint, client],
  );
}
