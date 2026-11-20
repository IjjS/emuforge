import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import { FOLLOW_MS, followsTask, followsTasks } from './follow';
import { getContainerLogs, LOG_OPERATIONS, type ContainerLog } from './logs-api';
import { ECS_KEYS, type EcsRead } from './queries';
import { getTask, listTasks, stopTask, TASK_OPERATIONS, type Task, type TaskFilters, type TaskRead } from './task-api';

// The TanStack Query hooks of a cluster's tasks (issue 575, design tasks 1 to 3), every key under s1's root of the
// cluster's tasks, so "Run task" and a change of a service read them again by that root. Every read is a request of
// its own on every mount, "Refresh" and "Retry"; a read no longer wanted is aborted, and its late answer, under a key
// nobody shows any more, changes nothing shown. A followed part (`follow.ts`) is read again every 3 seconds in place.

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** The key of a tasks table's listing: the desired status and the service (`null` for a cluster's table). */
export function tasksKey(cluster: string, filters: TaskFilters): unknown[] {
  return ECS_KEYS.clusterTasks(cluster, 'list', filters.desiredStatus, filters.service ?? null);
}

/** The key of the task `id`'s reads. */
export function taskKey(cluster: string, id: string, ...parts: unknown[]): unknown[] {
  return ECS_KEYS.clusterTasks(cluster, 'task', id, ...parts);
}

/**
 * A tasks table: a page of `ListTasks` and `DescribeTasks` at a time on the API's own tokens, by the filters; a change
 * of one starts again from the first page. While it shows "Running" and holds a task the page is read again every
 * 3 seconds with the same token.
 */
export function useTaskListing(
  endpoint: string | undefined,
  cluster: string,
  filters: TaskFilters,
  enabled = true,
): TokenListing<Task> {
  return useTokenListing({
    key: tasksKey(cluster, filters),
    endpoint,
    enabled,
    operation: TASK_OPERATIONS.listTasks,
    read: async (at, token, signal) => {
      const page = await listTasks(at, cluster, filters, token, signal);
      return page.nextToken === undefined ? { items: page.tasks } : { items: page.tasks, next: page.nextToken };
    },
    readAgainAfter: (tasks) => (followsTasks(tasks, filters.desiredStatus) ? FOLLOW_MS : false),
  });
}

interface ReadOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  enabled: boolean;
  operation: string;
  read: (endpoint: string, signal: AbortSignal) => Promise<T>;
  readAgainAfter?: (value: T) => number | false;
}

function useRead<T>({ key, endpoint, enabled, operation, read, readAgainAfter }: ReadOptions<T>): EcsRead<T> {
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

/** S5's read of the task `id`, read again every 3 seconds until it is `STOPPED`; nothing is read until `enabled`. */
export function useTask(endpoint: string | undefined, cluster: string, id: string, enabled = true): EcsRead<TaskRead> {
  return useRead({
    key: taskKey(cluster, id),
    endpoint,
    enabled,
    operation: TASK_OPERATIONS.describeTasks,
    read: (at, signal) => getTask(at, cluster, id, signal),
    readAgainAfter: (read) => (read.found && followsTask(read.task) ? FOLLOW_MS : false),
  });
}

/** The log of each container of the task `task`'s definition, read once per task page. */
export function useContainerLogs(
  endpoint: string | undefined,
  cluster: string,
  task: { id: string; definitionArn?: string },
): EcsRead<ContainerLog[]> {
  const definition = task.definitionArn;
  return useRead({
    key: taskKey(cluster, task.id, 'logs', definition ?? null),
    endpoint,
    enabled: definition !== undefined,
    operation: LOG_OPERATIONS.describeTaskDefinition,
    read: (at, signal) => getContainerLogs(at, definition ?? '', task.id, signal),
  });
}

/**
 * "Stop task" of the task `id`. Once it succeeds the task, every read of the cluster's tasks and the cluster's read
 * (its counts) are read again; a refusal changes nothing held.
 */
export function useStopTask(
  endpoint: string | undefined,
  cluster: string,
): (id: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await stopTask(endpoint, cluster, id, signal);
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusterTasks(cluster) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(cluster) });
    },
    [endpoint, cluster, client],
  );
}
