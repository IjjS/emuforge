import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { requestFailure, type RequestFailure } from '../../../../../lib/aws/request';
import {
  LIST_LAYER_VERSIONS,
  LIST_LAYERS,
  listLayerVersions,
  listLayers,
  PUBLISH_LAYER_VERSION,
  publishLayerVersion,
  type LayerPage,
} from './layer-api';
import { lambdaKey } from './queries';

interface LayerReadOptions {
  /** The engine origin, or undefined while the consumer cannot read. */
  endpoint: string | undefined;
  /** Changes when the local emulator connection changes. */
  scope: string;
}

type LayerReadTarget = { operation: typeof LIST_LAYERS } | { operation: typeof LIST_LAYER_VERSIONS; name: string };

function layerKey(endpoint: string | undefined, scope: string, operation: LayerReadTarget['operation'], name?: string) {
  return [...lambdaKey(endpoint), scope, operation, name ?? null];
}

export interface LayerReading<T> {
  items: T[] | undefined;
  loading: boolean;
  failure: RequestFailure | undefined;
  pageIndex: number;
  pageCount: number;
  changePage: (index: number) => void;
  refresh: () => void;
}

function useLayerReading<T>(
  { endpoint, scope }: LayerReadOptions,
  target: LayerReadTarget,
  read: (origin: string, marker: string | undefined, signal: AbortSignal) => Promise<LayerPage<T>>,
): LayerReading<T> {
  const { operation } = target;
  const name = 'name' in target ? target.name : undefined;
  const reading = JSON.stringify([endpoint, scope, operation, name]);
  const [pages, setPages] = useState({
    reading,
    markers: [undefined] as (string | undefined)[],
    index: 1,
  });
  if (pages.reading !== reading) {
    setPages({ reading, markers: [undefined], index: 1 });
  }

  const marker = pages.markers[pages.index - 1];
  const enabled = endpoint !== undefined && (operation === LIST_LAYERS || name !== '');
  const query = useQuery({
    queryKey: [...layerKey(endpoint, scope, operation, name), marker ?? null],
    enabled,
    queryFn: ({ signal }) => {
      if (endpoint === undefined) throw new Error('The engine endpoint is not known yet.');
      return read(endpoint, marker, signal);
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const failure = enabled && query.isError ? requestFailure(operation, query.error) : undefined;
  const nextMarker = query.data?.nextMarker;
  const canAdvance = !!nextMarker && !pages.markers.slice(0, pages.index).includes(nextMarker);
  const pageCount = canAdvance ? Math.max(pages.markers.length, pages.index + 1) : pages.markers.length;

  function changePage(index: number) {
    if (failure?.kind === 'not-implemented') return;
    if (index <= pages.markers.length) {
      setPages({ ...pages, index });
    } else if (canAdvance && index === pages.index + 1) {
      setPages({ ...pages, index, markers: [...pages.markers, nextMarker] });
    }
  }

  return {
    items: enabled && failure === undefined ? query.data?.items : undefined,
    loading: enabled && query.isPending,
    failure,
    pageIndex: pages.index,
    pageCount,
    changePage,
    refresh: () => {
      if (enabled && failure?.kind !== 'not-implemented') void query.refetch({ cancelRefetch: true });
    },
  };
}

export function useLayerListing(options: LayerReadOptions) {
  return useLayerReading(options, { operation: LIST_LAYERS }, listLayers);
}

export function useLayerVersions(options: LayerReadOptions, name: string | undefined) {
  const layer = name ?? '';
  return useLayerReading(options, { operation: LIST_LAYER_VERSIONS, name: layer }, (endpoint, marker, signal) =>
    listLayerVersions(endpoint, layer, marker, signal),
  );
}

export function usePublishLayerVersion({ endpoint, scope }: LayerReadOptions) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: ({ name, zip, signal }: { name: string; zip: Uint8Array; signal: AbortSignal }) => {
      if (endpoint === undefined) throw new Error('The engine endpoint is not known yet.');
      return publishLayerVersion(endpoint, name, zip, signal);
    },
    onSuccess: ({ name }, { signal }) => {
      if (signal.aborted) return;
      for (const key of [
        layerKey(endpoint, scope, LIST_LAYERS),
        layerKey(endpoint, scope, LIST_LAYER_VERSIONS, name),
      ]) {
        void queryClient.invalidateQueries({
          queryKey: key,
          predicate: ({ state }) => requestFailure(PUBLISH_LAYER_VERSION, state.error).kind !== 'not-implemented',
        });
      }
    },
  });
  return mutation;
}
