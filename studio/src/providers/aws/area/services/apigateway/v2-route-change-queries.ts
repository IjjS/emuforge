import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { failureOf, noEndpoint, usePageSignal } from '../../components/use-token-listing';
import { apiQueryKey, dropApiLists } from './queries';
import { GET_ROUTES } from './v2-api';
import { refreshV2Api, refreshV2Routes } from './v2-queries';
import {
  DELETE_ROUTE,
  UPDATE_API,
  deleteV2Route,
  isIntegrationShared,
  updateV2Api,
  type IntegrationDeletionWarning,
  type RouteDeletion,
  type V2ApiFields,
} from './v2-route-change-api';

export function useRouteIntegrationCheck(
  endpoint: string | undefined,
  apiId: string,
  routeId: string,
  integrationId: string | undefined,
) {
  const query = useQuery({
    queryKey: [...apiQueryKey(endpoint, 'v2', apiId), 'route-integration-check', routeId, integrationId],
    enabled: endpoint !== undefined && integrationId !== undefined,
    queryFn: ({ signal }) =>
      endpoint === undefined || integrationId === undefined
        ? noEndpoint()
        : isIntegrationShared(endpoint, apiId, routeId, integrationId, signal),
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });

  return {
    ready: integrationId === undefined || (!query.isFetching && query.isSuccess),
    exclusive: !query.isFetching && query.isSuccess && query.data === false,
    loading: integrationId !== undefined && (query.isFetching || query.isPending),
    failure: query.isError && !query.isFetching ? failureOf(query.error, GET_ROUTES) : undefined,
    retry: () => void query.refetch(),
  };
}

function useV2Change<Fields, Result>(
  endpoint: string | undefined,
  operation: string,
  change: (origin: string, fields: Fields, signal: AbortSignal) => Promise<Result>,
  onChanged: (result: Result) => void,
  refresh: (result: Result, fields: Fields) => Promise<void>,
) {
  const pageSignal = usePageSignal();
  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: ({ fields, signal }: { fields: Fields; signal: AbortSignal }) =>
      endpoint === undefined ? noEndpoint() : change(endpoint, fields, signal),
    onSuccess: (result, { fields, signal }) => {
      if (signal.aborted) return;
      onChanged(result);
      void refresh(result, fields);
    },
  });
  const failure = isError ? failureOf(error, operation) : undefined;
  const available = endpoint !== undefined && failure?.kind !== 'not-implemented';

  return {
    isPending,
    failure,
    available,
    submit: (fields: Fields) => {
      if (available && !isPending) mutate({ fields, signal: pageSignal() });
    },
  };
}

export function useUpdateV2Api(endpoint: string | undefined, apiId: string, onSaved: (name: string) => void) {
  const client = useQueryClient();
  return useV2Change(
    endpoint,
    UPDATE_API,
    async (origin, fields: V2ApiFields, signal) => {
      const api = await updateV2Api(origin, apiId, fields, signal);
      return api.Name ?? fields.name;
    },
    onSaved,
    () => {
      dropApiLists(client);
      return refreshV2Api(client, apiId);
    },
  );
}

export function useDeleteV2Route(
  endpoint: string | undefined,
  apiId: string,
  onDeleted: (warning: IntegrationDeletionWarning | undefined) => void,
) {
  const client = useQueryClient();
  return useV2Change(
    endpoint,
    DELETE_ROUTE,
    (origin, fields: RouteDeletion, signal) => deleteV2Route(origin, apiId, fields, signal),
    onDeleted,
    (warning, { routeId, integrationId }) =>
      refreshV2Routes(client, apiId, {
        endpoint,
        routeId,
        ...(warning === undefined && integrationId !== undefined && { integrationId }),
      }),
  );
}
