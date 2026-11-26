import { infiniteQueryOptions, useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, type TokenPage } from '../../components/use-token-listing';
import { GET_APIS, GET_REST_APIS, readRestApis, readV2Apis } from './apis-api';
import type { ApiModel } from './format';

const serviceKey = ['apigateway'] as const;
const listsKey = [...serviceKey, 'lists'] as const;
let listVisits = 0;

/** Prefix for every read of one API, independent of which part owns it. */
export function apiQueryKey(endpoint: string | undefined, kind: ApiModel, id: string) {
  return [...serviceKey, 'api', kind, id, endpoint] as const;
}

export interface AppendedPagesOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  operation: string;
  read: (endpoint: string, token: string | undefined, signal: AbortSignal) => Promise<TokenPage<T>>;
}

export interface AppendedPages<T> {
  items: T[] | undefined;
  more: boolean;
  loading: boolean;
  failure: RequestFailure | undefined;
  loadMore: () => void;
  retry: () => void;
  refresh: () => Promise<void>;
}

function appendedPageOptions<T>({ key, endpoint, read }: Omit<AppendedPagesOptions<T>, 'operation'>) {
  return infiniteQueryOptions({
    queryKey: key,
    enabled: endpoint !== undefined,
    queryFn: ({ signal, pageParam }) => (endpoint === undefined ? noEndpoint() : read(endpoint, pageParam, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useAppendedPages<T>({ key, endpoint, operation, read }: AppendedPagesOptions<T>): AppendedPages<T> {
  const client = useQueryClient();
  const query = useInfiniteQuery(appendedPageOptions({ key, endpoint, read }));
  const refresh = () => client.resetQueries({ queryKey: key, exact: true });

  return {
    items: query.data?.pages.flatMap((page) => page.items),
    more: query.hasNextPage,
    loading: query.isFetching || endpoint === undefined,
    failure: query.isError && !query.isFetching ? failureOf(query.error, operation) : undefined,
    loadMore: () => {
      if (query.hasNextPage) void query.fetchNextPage({ cancelRefetch: false });
    },
    retry: () => {
      if (query.isFetchNextPageError) {
        void query.fetchNextPage({ cancelRefetch: false });
      } else {
        void query.refetch({ cancelRefetch: false });
      }
    },
    refresh,
  };
}

export function useApiLists(endpoint: string | undefined) {
  const [visit] = useState(() => (listVisits += 1));
  const rest = useAppendedPages({
    key: [...listsKey, endpoint, 'rest', visit],
    endpoint,
    operation: GET_REST_APIS,
    read: readRestApis,
  });
  const v2 = useAppendedPages({
    key: [...listsKey, endpoint, 'v2', visit],
    endpoint,
    operation: GET_APIS,
    read: readV2Apis,
  });
  return { rest, v2 };
}

/** Replaces both lists with their first pages while keeping the current rows visible. */
export async function refreshApiLists(client: QueryClient): Promise<void> {
  const filters = { queryKey: listsKey, type: 'active' } as const;
  // Cancel even a first read with no data, so it cannot replace the post-change result.
  void client.cancelQueries(filters);
  await Promise.all(
    client
      .getQueryCache()
      .findAll(filters)
      .map(({ queryKey: key }) => {
        const [, , endpoint, model] = key;
        if (typeof endpoint !== 'string' || (model !== 'rest' && model !== 'v2')) return;

        const read = model === 'rest' ? readRestApis : readV2Apis;
        return client
          .infiniteQuery({ ...appendedPageOptions({ key, endpoint, read }), pages: 1, staleTime: 0 })
          .catch(() => undefined);
      }),
  );
}

export function dropApiLists(client: QueryClient): void {
  // Removing a query cancels its request and discards its pages.
  client.removeQueries({ queryKey: listsKey });
}

export function dropApi(client: QueryClient, kind: ApiModel, id: string): void {
  client.removeQueries({ queryKey: [...serviceKey, 'api', kind, id] });
}
