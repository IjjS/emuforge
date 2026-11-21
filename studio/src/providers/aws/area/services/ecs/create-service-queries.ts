import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { createService } from './create-service-api';
import type { CreateServiceRequest } from './create-service-form';
import { ECS_KEYS } from './queries';
import { serviceKey } from './service-queries';

export function useCreateService(endpoint: string | undefined) {
  const client = useQueryClient();
  return useCallback(
    async (request: CreateServiceRequest, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const name = await createService(endpoint, request, signal);
      const { cluster } = request;
      void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(cluster) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusterServices(cluster) });
      void client.invalidateQueries({ queryKey: ECS_KEYS.clusterTasks(cluster) });
      void client.invalidateQueries({ queryKey: serviceKey(cluster, name) });
      return name;
    },
    [client, endpoint],
  );
}
