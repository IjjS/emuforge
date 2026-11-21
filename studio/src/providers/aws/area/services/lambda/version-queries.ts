import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import { requestFailure } from '../../../../../lib/aws/request';
import { lambdaKey } from './queries';
import {
  changeRelease,
  listAliases,
  LIST_ALIASES,
  LIST_VERSIONS,
  listVersions,
  ReleaseRequestError,
  type ReleaseChange,
  type ReleaseFailure,
  type ReleaseResult,
} from './version-api';

function releaseFailure(operation: string, error: unknown): ReleaseFailure {
  const failure = requestFailure(operation, error);
  return error instanceof ReleaseRequestError ? { ...failure, reportedCode: error.reportedCode } : failure;
}

export interface ReleaseReading<T> {
  items: readonly T[] | undefined;
  failure: ReleaseFailure | undefined;
  loading: boolean;
  refresh: () => void;
}

interface ReleaseOptions {
  endpoint: string | undefined;
  name: string;
  session: number;
  /** The active release consumer. Changing tabs starts a fresh read when entering a consumer. */
  view: string | undefined;
  /** The function was verified in the current connection. */
  verified: boolean;
}

function useReleaseReading<T>(
  { endpoint, name, session, view, verified }: ReleaseOptions,
  operation: string,
  read: (endpoint: string, name: string, signal: AbortSignal) => Promise<T[]>,
): ReleaseReading<T> {
  const instance = useId();
  const [visit, setVisit] = useState({ view, revision: 0 });
  const [revision, setRevision] = useState(0);
  if (visit.view !== view) {
    setVisit({ view, revision: visit.revision + 1 });
  }
  const enabled = endpoint !== undefined && verified && view !== undefined;
  const query = useQuery({
    queryKey: [
      ...lambdaKey(endpoint),
      'releases',
      name,
      operation,
      instance,
      session,
      visit.revision,
      revision,
      verified,
    ],
    enabled,
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return read(endpoint, name, signal);
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    items: enabled ? query.data : undefined,
    failure: enabled && query.isError ? releaseFailure(operation, query.error) : undefined,
    loading: enabled && query.isPending,
    refresh: () => {
      setRevision((previous) => previous + 1);
    },
  };
}

export function useReleaseReadings(options: ReleaseOptions) {
  const versions = useReleaseReading(options, LIST_VERSIONS, listVersions);
  const aliases = useReleaseReading(options, LIST_ALIASES, listAliases);
  return { versions, aliases };
}

type ReleaseOperation = ReleaseChange['operation'];

interface ReleaseMutationOptions {
  endpoint: string | undefined;
  name: string;
  scope: string;
  onSuccess: (result: ReleaseResult) => void;
  onFailure: (failure: ReleaseFailure) => void;
}

export function useReleaseMutation({ endpoint, name, scope, onSuccess, onFailure }: ReleaseMutationOptions) {
  const inFlight = useRef<{ scope: string; controller: AbortController } | undefined>(undefined);
  const [state, setState] = useState<{ scope: string; unsupported: ReadonlySet<ReleaseOperation> }>({
    scope,
    unsupported: new Set(),
  });
  if (state.scope !== scope) {
    setState({ scope, unsupported: new Set() });
  }
  useLayoutEffect(
    () => () => {
      if (inFlight.current?.scope === scope) {
        inFlight.current.controller.abort();
        inFlight.current = undefined;
      }
    },
    [scope],
  );
  const mutation = useMutation({
    mutationFn: ({
      endpoint,
      name,
      change,
      signal,
    }: {
      endpoint: string;
      name: string;
      change: ReleaseChange;
      signal: AbortSignal;
      scope: string;
    }) => changeRelease(endpoint, name, change, signal),
  });

  async function submit(change: ReleaseChange): Promise<boolean> {
    if (endpoint === undefined || inFlight.current !== undefined || state.unsupported.has(change.operation)) {
      return false;
    }
    const controller = new AbortController();
    inFlight.current = { scope, controller };
    try {
      const result = await mutation.mutateAsync({ endpoint, name, change, signal: controller.signal, scope });
      if (!controller.signal.aborted) {
        onSuccess(result);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return false;
      }
      const failure = releaseFailure(change.operation, error);
      if (failure.kind === 'not-implemented') {
        setState((previous) => ({ scope, unsupported: new Set([...previous.unsupported, change.operation]) }));
      }
      onFailure(failure);
    } finally {
      if (inFlight.current?.controller === controller) {
        inFlight.current = undefined;
      }
    }
    return true;
  }

  return {
    submit,
    pending: mutation.isPending && mutation.variables.scope === scope ? mutation.variables.change.operation : undefined,
    unsupported: state.unsupported,
  };
}
