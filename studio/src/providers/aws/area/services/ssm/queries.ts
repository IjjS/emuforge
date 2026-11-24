import type { ParameterMetadata } from '@aws-sdk/client-ssm';
import { skipToken, useQuery, useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { bindAwsMutationAuthorization, type RequestFailure } from '../../../../../lib/aws/request';
import { targetOf } from '../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../components/emulator-line';
import { usePageFlash } from '../../components/page-flash';
import { failureOf, noEndpoint, useTokenListing } from '../../components/use-token-listing';
import { DESCRIBE_PARAMETERS, describeParameters, findParameter } from './api';
import { GET_RESOURCE_POLICIES, LIST_TAGS, listParameterTags, listResourcePolicies } from './resource-api';
import { GET_PARAMETER_HISTORY, getParameterHistory } from './version-api';

const SERVICE_KEY = ['aws', 'ssm'] as const;
const PAGE_SIZE = 50;

function targetKey(connection: AreaConnection) {
  const target = connection.result === undefined ? undefined : targetOf(connection.result);
  return [...SERVICE_KEY, connection.engineOrigin, target] as const;
}

function readFailure({ result }: AreaConnection): RequestFailure | undefined {
  switch (result?.kind) {
    case 'engine-unreachable':
      return { kind: 'engine-did-not-answer', operation: DESCRIBE_PARAMETERS };
    case 'emulator-unreachable':
      return { kind: 'emulator-did-not-answer', operation: DESCRIBE_PARAMETERS, message: result.message };
    case 'engine-error':
      return { kind: 'other', operation: DESCRIBE_PARAMETERS, code: result.code ?? `HTTP ${String(result.status)}` };
  }
}

function useReadScope(connection: AreaConnection) {
  const failure = readFailure(connection);
  const disconnected = failure !== undefined;
  const checkedAt = connection.result?.checkedAt;
  const key = JSON.stringify(targetKey(connection));
  const [state, setState] = useState({ key, disconnected, generation: 0, retryAt: undefined as number | undefined });
  if (
    state.key !== key ||
    state.disconnected !== disconnected ||
    (state.retryAt !== undefined && state.retryAt !== checkedAt)
  ) {
    setState({ key, disconnected, generation: state.generation + 1, retryAt: undefined });
  }
  return {
    generation: state.generation,
    failure: state.retryAt === undefined ? failure : undefined,
    disconnected,
    retry: () =>
      setState({ ...state, generation: state.generation + 1, retryAt: disconnected ? checkedAt : undefined }),
  };
}

/** A 501 applies to the operation for this engine and target, including its other entry points. */
export function useUnsupportedOperation(connection: AreaConnection, operation: string) {
  const client = useQueryClient();
  const [, , endpoint, target] = targetKey(connection);
  const { data } = useQuery<RequestFailure>({
    queryKey: [...SERVICE_KEY, endpoint, target, 'unsupported', operation],
    queryFn: skipToken,
    staleTime: Infinity,
  });
  const markUnsupported = useCallback(
    (failure: RequestFailure) =>
      client.setQueryData([...SERVICE_KEY, endpoint, target, 'unsupported', operation], failure),
    [client, endpoint, target, operation],
  );
  return { failure: data, markUnsupported };
}

export function useParameterListing(connection: AreaConnection) {
  const scope = useReadScope(connection);
  const unsupported = useUnsupportedOperation(connection, DESCRIBE_PARAMETERS);
  const key = [...targetKey(connection), 'list'];
  const { data: revision = 0 } = useQuery<number>({ queryKey: [...key, 'revision'], queryFn: skipToken });
  const listing = useTokenListing<ParameterMetadata>({
    key: [...key, 'page', PAGE_SIZE, scope.generation, revision],
    endpoint: connection.engineOrigin,
    enabled: scope.failure === undefined && unsupported.failure === undefined,
    operation: DESCRIBE_PARAMETERS,
    read: async (endpoint, token, signal) => {
      const { Parameters, NextToken } = await describeParameters(
        endpoint,
        { MaxResults: PAGE_SIZE, NextToken: token },
        signal,
      );
      signal.throwIfAborted();
      return { items: Parameters ?? [], ...(NextToken ? { next: NextToken } : {}) };
    },
  });
  const failure = unsupported.failure ?? scope.failure ?? listing.failure;
  return {
    ...listing,
    failure,
    rememberFailure: unsupported.markUnsupported,
    disconnected: scope.disconnected,
    generation: scope.generation,
    selectionKey: JSON.stringify([scope.generation, revision, listing.currentPage]),
    refresh: () => {
      if (failure?.kind !== 'not-implemented') scope.retry();
    },
  };
}

export function useParameterMetadata(connection: AreaConnection, name: string) {
  const scope = useReadScope(connection);
  const endpoint = connection.engineOrigin;
  const unsupported = useUnsupportedOperation(connection, DESCRIBE_PARAMETERS);
  const query = useQuery({
    queryKey: [...targetKey(connection), 'metadata', name, scope.generation],
    queryFn: ({ signal }) => findParameter(endpoint ?? noEndpoint(), name, signal),
    enabled: endpoint !== undefined && name !== '' && scope.failure === undefined && unsupported.failure === undefined,
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const failure =
    unsupported.failure ?? scope.failure ?? (query.isError ? failureOf(query.error, DESCRIBE_PARAMETERS) : undefined);
  return {
    metadata: failure === undefined ? query.data : undefined,
    failure,
    rememberFailure: unsupported.markUnsupported,
    disconnected: scope.disconnected,
    loading: failure === undefined && name !== '' && (query.isPending || query.isFetching),
    refresh: () => {
      if (failure?.kind === 'not-implemented') return;
      if (scope.failure !== undefined) scope.retry();
      else void query.refetch();
    },
  };
}

/** Discard every list token and reconcile any open metadata affected by a write. */
export function useRefreshParameterReads(connection: AreaConnection) {
  const client = useQueryClient();
  const key = targetKey(connection);
  return (names: readonly string[]) => {
    const list: QueryFilters = { queryKey: [...key, 'list', 'page'] };
    void client.cancelQueries(list);
    void client.invalidateQueries({ ...list, refetchType: 'none' });
    client.setQueryData<number>([...key, 'list', 'revision'], (revision = 0) => revision + 1);

    if (client.getQueryData([...key, 'unsupported', DESCRIBE_PARAMETERS]) !== undefined) return;
    for (const name of names) {
      const metadata = { queryKey: [...key, 'metadata', name] };
      void client.cancelQueries(metadata);
      void client.invalidateQueries(metadata);
    }
  };
}

/** Save refreshes the resource reads and any cached version history for the edited name. */
export function useRefreshParameterSave(connection: AreaConnection) {
  const client = useQueryClient();
  const refresh = useRefreshParameterReads(connection);
  return (name: string, editing: boolean) => {
    if (editing) {
      const history = { queryKey: [...targetKey(connection), 'history', name] };
      void client.cancelQueries(history);
      void client.invalidateQueries(history);
    }
    refresh([name]);
  };
}

export function useParameterHistory(connection: AreaConnection, name: string) {
  const unsupported = useUnsupportedOperation(connection, GET_PARAMETER_HISTORY);
  const listing = useTokenListing({
    key: [...targetKey(connection), 'history', name],
    endpoint: connection.engineOrigin,
    enabled: unsupported.failure === undefined,
    operation: GET_PARAMETER_HISTORY,
    read: async (endpoint, token, signal) => {
      const page = await getParameterHistory(endpoint, name, token, signal);
      signal.throwIfAborted();
      return page;
    },
  });
  return {
    ...listing,
    failure: unsupported.failure ?? listing.failure,
    rememberFailure: unsupported.markUnsupported,
  };
}

export function useRefreshParameterLabels(connection: AreaConnection) {
  const client = useQueryClient();
  const refresh = useRefreshParameterReads(connection);
  return (name: string) => {
    const history = { queryKey: [...targetKey(connection), 'history', name] };
    void client.cancelQueries(history);
    void client.invalidateQueries(history);
    refresh([name]);
  };
}

const tagKey = (name: string) => ['tags', name] as const;
const policyKey = (arn: string) => ['resource-policies', arn] as const;
type ResourceKey = ReturnType<typeof tagKey> | ReturnType<typeof policyKey>;

function useResourceRead<T>(
  connection: AreaConnection,
  key: ResourceKey,
  operation: string,
  read: (endpoint: string, id: string, signal: AbortSignal) => Promise<T>,
) {
  const endpoint = connection.engineOrigin;
  const unsupported = useUnsupportedOperation(connection, operation);
  const query = useQuery({
    queryKey: [...targetKey(connection), ...key],
    queryFn: endpoint === undefined ? skipToken : ({ signal }) => read(endpoint, key[1], signal),
    enabled: endpoint !== undefined && unsupported.failure === undefined,
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const failure = unsupported.failure ?? (query.isError ? failureOf(query.error, operation) : undefined);
  const { markUnsupported } = unsupported;
  useEffect(() => {
    if (failure?.kind === 'not-implemented') markUnsupported(failure);
  }, [failure, markUnsupported]);
  return {
    items: failure ? undefined : query.data,
    failure,
    loading: endpoint !== undefined && !failure && (query.isPending || query.isFetching),
    retry: () => void query.refetch(),
  };
}

export function useParameterTags(connection: AreaConnection, name: string) {
  return useResourceRead(connection, tagKey(name), LIST_TAGS, listParameterTags);
}

export function useParameterResourcePolicies(connection: AreaConnection, arn: string) {
  return useResourceRead(connection, policyKey(arn), GET_RESOURCE_POLICIES, listResourcePolicies);
}

export function useParameterTagWrite(connection: AreaConnection, name: string, operation: string) {
  return useParameterResourceWrite(connection, name, tagKey(name), operation);
}

export function useParameterPolicyWrite(connection: AreaConnection, name: string, arn: string, operation: string) {
  return useParameterResourceWrite(connection, name, policyKey(arn), operation);
}

function useParameterResourceWrite(connection: AreaConnection, name: string, key: ResourceKey, operation: string) {
  const endpoint = connection.engineOrigin;
  const unsupported = useUnsupportedOperation(connection, operation);
  const client = useQueryClient();
  const flash = usePageFlash();
  const refresh = useRefreshParameterReads(connection);
  const request = useRef<AbortController | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [],
  );

  const disabled = endpoint === undefined || pending || unsupported.failure !== undefined;
  async function run(
    write: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    message: string,
    onClose: () => void,
  ) {
    if (disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const release = bindAwsMutationAuthorization(controller, { cancelInFlight: true });
    setPending(true);
    setFailure(undefined);
    try {
      await write(endpoint, controller.signal);
      if (controller.signal.aborted) return;
      flash.show([{ type: 'success', content: message }]);
      const resource = { queryKey: [...targetKey(connection), ...key] };
      void client.cancelQueries(resource);
      void client.invalidateQueries(resource);
      refresh([name]);
      onClose();
    } catch (error) {
      if (controller.signal.aborted) return;
      const nextFailure = failureOf(error, operation);
      if (nextFailure.kind === 'not-implemented') {
        unsupported.markUnsupported(nextFailure);
        onClose();
      } else {
        setFailure(nextFailure);
      }
    } finally {
      release();
      if (request.current === controller) {
        request.current = undefined;
        setPending(false);
      }
    }
  }

  return { pending, disabled, failure, run };
}
