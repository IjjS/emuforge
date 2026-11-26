import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { createMethod } from './method-create-api';
import type { MethodInput } from './method-form';
import { apiQueryKey } from './queries';
import { GET_RESOURCE, readRestResource } from './rest-api';
import { refreshRestResources } from './rest-queries';

export function useLinkedMethodResource(apiId: string, resourceId: string | undefined, endpoint: string | undefined) {
  const query = useQuery({
    queryKey: [...apiQueryKey(endpoint, 'rest', apiId), 'method-resource', resourceId],
    enabled: endpoint !== undefined && resourceId !== undefined,
    queryFn: ({ signal }) =>
      endpoint === undefined || resourceId === undefined
        ? noEndpoint()
        : readRestResource(endpoint, apiId, resourceId, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
  return {
    data: query.data,
    loading: resourceId !== undefined && (query.isFetching || endpoint === undefined),
    failure: query.isError && !query.isFetching ? failureOf(query.error, GET_RESOURCE) : undefined,
    retry: () => void query.refetch(),
  };
}

export function useCreateMethod(apiId: string, endpoint: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, signal }: { input: MethodInput; signal: AbortSignal }) =>
      createMethod(endpoint, apiId, input, signal),
    networkMode: 'always',
    onSuccess: (outcome) => {
      if (outcome.kind === 'created' || outcome.kind === 'left') void refreshRestResources(client, apiId);
    },
  });
}
