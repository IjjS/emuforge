import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { bindAwsMutationAuthorization, requestFailure, type RequestFailure } from '../../../../../lib/aws/request';
import { changeEventSource, LIST_EVENT_SOURCES, listEventSources, type EventSourceChange } from './event-source-api';
import { lambdaKey } from './queries';

type EventSourceOperation = EventSourceChange['operation'];

interface EventSourcesOptions {
  endpoint: string | undefined;
  name: string;
  scope: string;
  active: boolean;
}

export function useEventSources({ endpoint, name, scope, active }: EventSourcesOptions) {
  const client = useQueryClient();
  const queryKey = [...lambdaKey(endpoint), 'event-sources', name, scope];
  const previousError = client.getQueryState(queryKey)?.error;
  const unavailable =
    previousError != null && requestFailure(LIST_EVENT_SOURCES, previousError).kind === 'not-implemented';
  const reading = useQuery({
    queryKey,
    enabled: active && endpoint !== undefined && !unavailable,
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return listEventSources(endpoint, name, signal);
    },
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const failure = reading.isError ? requestFailure(LIST_EVENT_SOURCES, reading.error) : undefined;

  const [support, setSupport] = useState<{ scope: string; unsupported: ReadonlySet<EventSourceOperation> }>({
    scope,
    unsupported: new Set(),
  });
  if (support.scope !== scope) {
    setSupport({ scope, unsupported: new Set() });
  }
  const inFlight = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = undefined;
    },
    [scope],
  );

  const mutation = useMutation({
    mutationFn: (input: {
      endpoint: string;
      name: string;
      change: EventSourceChange;
      signal: AbortSignal;
      scope: string;
    }) => changeEventSource(input.endpoint, input.name, input.change, input.signal),
  });

  async function submit(
    change: EventSourceChange,
    beforeUnsupported?: () => void,
  ): Promise<{ failure?: RequestFailure } | undefined> {
    if (
      !active ||
      endpoint === undefined ||
      !navigator.onLine ||
      inFlight.current ||
      support.unsupported.has(change.operation)
    ) {
      return undefined;
    }
    const controller = new AbortController();
    const dispose = bindAwsMutationAuthorization(controller);
    inFlight.current = controller;
    try {
      await mutation.mutateAsync({ endpoint, name, change, signal: controller.signal, scope });
      if (controller.signal.aborted) {
        return undefined;
      }
      // Invalidate only this function's list. Cancel even the initial read, which has no cached answer to refetch.
      const filter = { queryKey, exact: true };
      await client.cancelQueries(filter);
      if (controller.signal.aborted) {
        return undefined;
      }
      void client.invalidateQueries(filter);
    } catch (error) {
      if (controller.signal.aborted) {
        return undefined;
      }
      const refusal = requestFailure(change.operation, error);
      if (refusal.kind === 'not-implemented') {
        beforeUnsupported?.();
        setSupport((current) => ({ scope, unsupported: new Set([...current.unsupported, change.operation]) }));
      }
      return { failure: refusal };
    } finally {
      dispose();
      if (inFlight.current === controller) {
        inFlight.current = undefined;
      }
    }
    return {};
  }

  return {
    items: reading.data ?? [],
    failure,
    loading: reading.isPending,
    refreshing: reading.isFetching,
    refresh: () => {
      if (active && failure?.kind !== 'not-implemented') {
        void reading.refetch();
      }
    },
    submit,
    pending: mutation.isPending && mutation.variables.scope === scope ? mutation.variables.change.operation : undefined,
    unsupported: support.unsupported,
  };
}
