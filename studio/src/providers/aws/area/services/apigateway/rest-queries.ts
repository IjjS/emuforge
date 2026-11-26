import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { apiQueryKey, useAppendedPages } from './queries';
import {
  GET_RESOURCES,
  GET_REST_API,
  GET_REST_STAGES,
  GET_STAGE_ADDRESS,
  readRestApi,
  readRestResources,
  readRestStages,
  readStageAddress,
} from './rest-api';

function restKey(endpoint: string | undefined, id: string, part: 'details' | 'resources' | 'stages') {
  return [...apiQueryKey(endpoint, 'rest', id), part] as const;
}

function useRestRead<T>(
  key: readonly unknown[],
  endpoint: string | undefined,
  operation: string,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
) {
  const query = useQuery({
    queryKey: key,
    enabled: endpoint !== undefined,
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : read(endpoint, signal)),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });

  return {
    data: query.data,
    loading: query.isFetching || endpoint === undefined,
    failure: query.isError && !query.isFetching ? failureOf(query.error, operation) : undefined,
  };
}

export function useRestApi(id: string, endpoint: string | undefined) {
  return useRestRead(restKey(endpoint, id, 'details'), endpoint, GET_REST_API, (origin, signal) =>
    readRestApi(origin, id, signal),
  );
}

export function useRestResources(id: string, endpoint: string | undefined) {
  const list = useAppendedPages({
    key: restKey(endpoint, id, 'resources'),
    endpoint,
    operation: GET_RESOURCES,
    read: (origin, token, signal) => readRestResources(origin, id, token, signal),
  });
  const [previous, setPrevious] = useState({ id, endpoint, items: list.items });
  // Keep the current rows on screen while a first page replaces them after refresh.
  const sameRead = previous.id === id && previous.endpoint === endpoint;
  if (
    !sameRead ||
    (list.items !== undefined &&
      (list.items.length !== previous.items?.length ||
        list.items.some((item, index) => item !== previous.items?.[index]))) ||
    (!list.loading && list.items === undefined && previous.items !== undefined)
  ) {
    setPrevious({ id, endpoint, items: list.items });
  }
  return {
    ...list,
    items: list.items ?? (sameRead && list.loading ? previous.items : undefined),
  };
}

export function useRestStages(id: string, endpoint: string | undefined) {
  return useRestRead(restKey(endpoint, id, 'stages'), endpoint, GET_REST_STAGES, (origin, signal) =>
    readRestStages(origin, id, signal),
  );
}

export function useStageAddress(id: string, stage: string, endpoint: string | undefined) {
  return useRestRead([...restKey(endpoint, id, 'stages'), stage], endpoint, GET_STAGE_ADDRESS, (origin, signal) =>
    readStageAddress(origin, id, stage, signal),
  );
}

function restReadFilters(id: string, part: 'details' | 'resources' | 'stages') {
  const prefix = apiQueryKey(undefined, 'rest', id).slice(0, -1);
  return {
    queryKey: prefix,
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => queryKey[prefix.length + 1] === part,
  };
}

async function refreshRestRead(client: QueryClient, id: string, part: 'details' | 'stages') {
  const filters = restReadFilters(id, part);
  // Refetching an initial read without cached data otherwise joins the request already in flight.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}

export function refreshRestApi(client: QueryClient, id: string): Promise<void> {
  return refreshRestRead(client, id, 'details');
}

export function refreshRestResources(client: QueryClient, id: string): Promise<void> {
  return client.resetQueries(restReadFilters(id, 'resources'));
}

export function refreshRestStages(client: QueryClient, id: string): Promise<void> {
  return refreshRestRead(client, id, 'stages');
}
