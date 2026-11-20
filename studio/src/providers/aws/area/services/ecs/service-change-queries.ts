import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { ECS_KEYS } from './queries';
import { deleteService, updateService } from './service-change-api';
import { serviceKey } from './service-queries';
import { tasksKey } from './task-queries';
import type { UpdateRequest } from './update-form';

// The hooks of S4's changes (issue 575, design task 6), over `service-change-api.ts`. A success reads again what it
// changed, by the key roots; a refusal changes nothing held.

/**
 * "Update service" of the service `name`. Once it succeeds the service's read and its tasks' tables (either desired
 * status) are read again.
 */
export function useUpdateService(
  endpoint: string | undefined,
  cluster: string,
): (name: string, request: UpdateRequest, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (name: string, request: UpdateRequest, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await updateService(endpoint, cluster, name, request, signal);
      void client.invalidateQueries({ queryKey: serviceKey(cluster, name) });
      void client.invalidateQueries({ queryKey: tasksKey(cluster, { desiredStatus: 'RUNNING', service: name }) });
      void client.invalidateQueries({ queryKey: tasksKey(cluster, { desiredStatus: 'STOPPED', service: name }) });
    },
    [endpoint, cluster, client],
  );
}

/**
 * "Delete service" of the service `name`. Once it succeeds the cluster's services, every read of the cluster's tasks
 * (the forced delete stops the service's) and the cluster's read (its counts) are read again.
 */
export function useDeleteService(
  endpoint: string | undefined,
  cluster: string,
): (name: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (name: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteService(endpoint, cluster, name, signal);
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusterServices(cluster) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusterTasks(cluster) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(cluster) });
    },
    [endpoint, cluster, client],
  );
}
