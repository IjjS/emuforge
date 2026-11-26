import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { failureOf, noEndpoint, type TokenPage } from '../../components/use-token-listing';
import { apiQueryKey, useAppendedPages } from './queries';
import {
  GET_API,
  GET_INTEGRATIONS,
  GET_ROUTES,
  GET_STAGES,
  getV2Api,
  readV2Integrations,
  readV2Routes,
  readV2Stages,
} from './v2-api';

type V2List = 'routes' | 'integrations' | 'stages';
type V2Part = 'detail' | V2List;
type PageRead<T> = (
  endpoint: string,
  id: string,
  token: string | undefined,
  signal: AbortSignal,
) => Promise<TokenPage<T>>;

function partKey(endpoint: string | undefined, id: string, part: V2Part) {
  return [...apiQueryKey(endpoint, 'v2', id), part] as const;
}

export function useV2Api(endpoint: string | undefined, id: string) {
  const client = useQueryClient();
  const queryKey = partKey(endpoint, id, 'detail');
  const query = useQuery({
    queryKey,
    enabled: endpoint !== undefined,
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getV2Api(endpoint, id, signal)),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });

  return {
    value: query.data,
    failure: query.isError && !query.isFetching ? failureOf(query.error, GET_API) : undefined,
    loading: query.isFetching || endpoint === undefined,
    refresh: () => refreshDetail(client, { queryKey, exact: true }),
  };
}

function useV2List<T>(endpoint: string | undefined, id: string, part: V2List, operation: string, read: PageRead<T>) {
  return useAppendedPages({
    key: partKey(endpoint, id, part),
    endpoint,
    operation,
    read: (origin, token, signal) => read(origin, id, token, signal),
  });
}

export function useV2Routes(endpoint: string | undefined, id: string) {
  return useV2List(endpoint, id, 'routes', GET_ROUTES, readV2Routes);
}

export function useV2Integrations(endpoint: string | undefined, id: string) {
  return useV2List(endpoint, id, 'integrations', GET_INTEGRATIONS, readV2Integrations);
}

export function useV2Stages(endpoint: string | undefined, id: string) {
  return useV2List(endpoint, id, 'stages', GET_STAGES, readV2Stages);
}

function partFilters(id: string, part: V2Part) {
  const prefix = apiQueryKey(undefined, 'v2', id);
  return {
    queryKey: prefix.slice(0, -1),
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => queryKey[prefix.length] === part,
  };
}

function refreshDetail(client: QueryClient, filters: Parameters<QueryClient['cancelQueries']>[0]) {
  // Cancel even if this is the first read and there is no cached answer yet.
  void client.cancelQueries(filters);
  return client.refetchQueries({ ...filters, type: 'active' });
}

function refreshList<T>(client: QueryClient, id: string, part: V2List, read: PageRead<T>) {
  return client
    .getQueryCache()
    .findAll(partFilters(id, part))
    .map((query) => {
      const { queryKey } = query;
      const endpoint = queryKey.at(-2);
      if (!query.isActive() || typeof endpoint !== 'string') {
        return client.resetQueries({ queryKey, exact: true });
      }

      // Read only page one, leaving the displayed pages in place until it answers.
      void client.cancelQueries({ queryKey, exact: true });
      return client
        .infiniteQuery({
          queryKey,
          queryFn: ({ signal, pageParam }) => read(endpoint, id, pageParam, signal),
          initialPageParam: undefined as string | undefined,
          getNextPageParam: (page) => page.next,
          pages: 1,
          staleTime: 0,
          gcTime: 0,
          retry: false,
        })
        .catch(() => undefined);
    });
}

export function refreshV2Api(client: QueryClient, id: string) {
  return refreshDetail(client, partFilters(id, 'detail'));
}

export async function refreshV2Routes(client: QueryClient, id: string) {
  await Promise.all([
    ...refreshList(client, id, 'routes', readV2Routes),
    ...refreshList(client, id, 'integrations', readV2Integrations),
  ]);
}

export async function refreshV2Stages(client: QueryClient, id: string) {
  await Promise.all(refreshList(client, id, 'stages', readV2Stages));
}
