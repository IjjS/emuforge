import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  actOnInstance,
  getInstance,
  getTerminationProtection,
  listInstances,
  OPERATIONS,
  type Instance,
  type InstanceFilters,
  type InstanceRead,
} from './api';
import { isMoving, READ_AGAIN_MS, type InstanceAction } from './instance-state';

// The TanStack Query hooks of EC2's instance screens, and the query keys of every resource of EC2 (issue 553, design
// "Code layout and the cut"), so an action of one unit reads again what another unit shows. Every read is a request
// of its own on every mount, "Refresh" and "Retry", under a key that holds every filter and token; a read no longer
// wanted is aborted, and its late answer, under a key nobody shows any more, changes nothing shown. While an
// instance shown is in a state that moves by itself its read is made again every 3 seconds, in place.

/** The start of every key of EC2's reads. */
export const EC2_KEY = ['aws', 'ec2'] as const;

/**
 * The keys of EC2's reads, each a prefix of the reads it names: with its filters given, the key of one list; with
 * fewer, of every list of the resource it starts, which is what a mutation reads again.
 */
export const EC2_KEYS = {
  /** S1's lists: by state, then by name. */
  instances: (...filters: unknown[]) => [...EC2_KEY, 'instances', ...filters],
  /** S3's reads of one instance, its termination protection included. */
  instance: (id: string, ...parts: unknown[]) => [...EC2_KEY, 'instance', id, ...parts],
  /** S4's lists: by name. */
  securityGroups: (...filters: unknown[]) => [...EC2_KEY, 'security-groups', ...filters],
  /** S6's reads of one group. */
  securityGroup: (id: string, ...parts: unknown[]) => [...EC2_KEY, 'security-group', id, ...parts],
  /** S6's rules of one group. */
  rules: (groupId: string, ...parts: unknown[]) => [...EC2_KEY, 'rules', groupId, ...parts],
  /** S8's list. */
  keyPairs: (...parts: unknown[]) => [...EC2_KEY, 'key-pairs', ...parts],
  /** A form's choices, by what they are of ("images", "instance-types", "key-pairs", "subnets", …) and filter. */
  choices: (of?: string, ...filters: unknown[]) =>
    of === undefined ? [...EC2_KEY, 'choices'] : [...EC2_KEY, 'choices', of, ...filters],
};

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** S1's settled filters: the state (`''` for "Any state") and the name's text (`''` for none). */
export interface ListingFilters {
  state: string;
  name: string;
}

function anyMoving(instances: readonly Instance[]): number | false {
  return instances.some((instance) => isMoving(instance.state)) ? READ_AGAIN_MS : false;
}

/**
 * S1: the instances, a page of `DescribeInstances` at a time on its own tokens, with the filters; a change of either
 * starts again from the first page. While a row is `pending`, `stopping` or `shutting-down` the page is read again
 * every 3 seconds with the same token and filters.
 */
export function useInstanceListing(endpoint: string | undefined, filters: ListingFilters): TokenListing<Instance> {
  const sent: InstanceFilters = {
    ...(filters.state === '' ? {} : { state: filters.state }),
    ...(filters.name === '' ? {} : { name: filters.name }),
  };
  return useTokenListing({
    key: EC2_KEYS.instances(filters.state, filters.name),
    endpoint,
    operation: OPERATIONS.describeInstances,
    read: async (at, token, signal) => {
      const page = await listInstances(at, sent, token, signal);
      return page.nextToken === undefined
        ? { items: page.instances }
        : { items: page.instances, next: page.nextToken };
    },
    readAgainAfter: anyMoving,
  });
}

/** One read as a screen shows it. */
export interface Ec2Read<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** The read is in flight with nothing of it shown, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

interface ReadOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  operation: string;
  read: (endpoint: string, signal: AbortSignal) => Promise<T>;
  readAgainAfter?: (value: T) => number | false;
}

function useRead<T>({ key, endpoint, operation, read, readAgainAfter }: ReadOptions<T>): Ec2Read<T> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...key, endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : read(endpoint, signal)),
    enabled: endpoint !== undefined,
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

/** S3's read of the instance `id`, made again every 3 seconds while its state moves by itself. */
export function useInstance(endpoint: string | undefined, id: string): Ec2Read<InstanceRead> {
  return useRead({
    key: EC2_KEYS.instance(id),
    endpoint,
    operation: OPERATIONS.describeInstances,
    read: (at, signal) => getInstance(at, id, signal),
    readAgainAfter: (read) => (read.found && isMoving(read.instance.state) ? READ_AGAIN_MS : false),
  });
}

/** S3's read of the termination protection of the instance `id`, a read of its own: `true` for on. */
export function useTerminationProtection(endpoint: string | undefined, id: string): Ec2Read<boolean> {
  return useRead({
    key: EC2_KEYS.instance(id, 'termination-protection'),
    endpoint,
    operation: OPERATIONS.describeInstanceAttribute,
    read: (at, signal) => getTerminationProtection(at, id, signal),
  });
}

/**
 * "Start", "Stop", "Reboot", "Terminate" of one instance. Once it is answered, 200 or a failure, the instance lists
 * and that instance are read again: a refusal usually means the state on screen was behind.
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
        void client.invalidateQueries({ queryKey: EC2_KEYS.instances() });
        void client.invalidateQueries({ queryKey: EC2_KEYS.instance(id) });
      }
    },
    [endpoint, client],
  );
}
