import type { SecretListEntry, SecretVersionsListEntry } from '@aws-sdk/client-secrets-manager';
import { useQuery, useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import type { AreaConnection } from '../../components/emulator-line';
import { failureOf, noEndpoint, useTokenListing } from '../../components/use-token-listing';
import { DESCRIBE_SECRET, describeSecret, LIST_SECRETS, listSecrets } from './api';
import {
  GET_RESOURCE_POLICY,
  getResourcePolicy,
  LIST_SECRET_VERSION_IDS,
  listSecretVersionIds,
} from './versions-policy-api';

const SERVICE_KEY = ['aws', 'secretsmanager'] as const;
const PAGE_SIZE = 50;

/** A connection transition starts a new read scope and invalidates in-flight requests and page tokens. */
function useReadScope(connection: AreaConnection, operation: string) {
  let failure: RequestFailure | undefined;
  const result = connection.result;
  switch (result?.kind) {
    case 'engine-unreachable':
      failure = { kind: 'engine-did-not-answer', operation };
      break;
    case 'emulator-unreachable':
      failure = { kind: 'emulator-did-not-answer', operation, message: result.message };
      break;
    case 'engine-error':
      failure = { kind: 'other', operation, code: result.code ?? `HTTP ${String(result.status)}` };
      break;
  }
  const disconnected = failure !== undefined;
  const [scope, setScope] = useState({ disconnected, generation: 0 });
  if (disconnected !== scope.disconnected) {
    setScope({ disconnected, generation: scope.generation + 1 });
  }
  return { connectionFailure: failure, generation: scope.generation };
}

export function useSecretListing(connection: AreaConnection, includePlannedDeletion: boolean) {
  const { connectionFailure, generation } = useReadScope(connection, LIST_SECRETS);
  const listing = useTokenListing<SecretListEntry>({
    key: [...SERVICE_KEY, LIST_SECRETS, includePlannedDeletion, PAGE_SIZE, generation],
    endpoint: connection.engineOrigin,
    enabled: connectionFailure === undefined,
    operation: LIST_SECRETS,
    read: async (endpoint, token, signal) => {
      const { SecretList, NextToken } = await listSecrets(
        endpoint,
        { MaxResults: PAGE_SIZE, IncludePlannedDeletion: includePlannedDeletion, NextToken: token },
        signal,
      );
      signal.throwIfAborted();
      return { items: SecretList ?? [], ...(NextToken ? { next: NextToken } : {}) };
    },
  });
  return { ...listing, connectionFailure };
}

export function useSecretDetail(connection: AreaConnection, name: string) {
  const { connectionFailure, generation } = useReadScope(connection, DESCRIBE_SECRET);
  const endpoint = connection.engineOrigin;
  const query = useQuery({
    queryKey: [...SERVICE_KEY, DESCRIBE_SECRET, endpoint, name, generation],
    queryFn: ({ signal }) => describeSecret(endpoint ?? noEndpoint(), name, signal),
    enabled: endpoint !== undefined && name !== '' && connectionFailure === undefined,
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  return {
    details: query.isError ? undefined : query.data,
    failure: query.isError ? failureOf(query.error, DESCRIBE_SECRET) : undefined,
    connectionFailure,
    loading: query.isFetching || (endpoint === undefined && connectionFailure === undefined),
    refresh: () => void query.refetch(),
  };
}

export function useVersionListing(endpoint: string, name: string, opened: boolean) {
  const [unsupported, setUnsupported] = useState<RequestFailure>();
  const listing = useTokenListing<SecretVersionsListEntry>({
    key: [...SERVICE_KEY, LIST_SECRET_VERSION_IDS, name, true, PAGE_SIZE],
    endpoint,
    enabled: opened && unsupported === undefined,
    operation: LIST_SECRET_VERSION_IDS,
    read: async (origin, token, signal) => {
      const { Versions, NextToken } = await listSecretVersionIds(
        origin,
        { SecretId: name, IncludeDeprecated: true, MaxResults: PAGE_SIZE, NextToken: token },
        signal,
      );
      signal.throwIfAborted();
      return { items: Versions ?? [], ...(NextToken ? { next: NextToken } : {}) };
    },
  });
  if (unsupported === undefined && listing.failure?.kind === 'not-implemented') setUnsupported(listing.failure);
  return { ...listing, failure: unsupported ?? listing.failure };
}

export function useResourcePolicy(endpoint: string, name: string, opened: boolean) {
  const query = useQuery({
    queryKey: [...SERVICE_KEY, GET_RESOURCE_POLICY, endpoint, name],
    queryFn: ({ signal }) => getResourcePolicy(endpoint, name, signal),
    enabled: (query) => opened && failureOf(query.state.error, GET_RESOURCE_POLICY).kind !== 'not-implemented',
    retry: false,
    gcTime: 0,
  });
  return {
    document: query.isError ? undefined : query.data?.ResourcePolicy,
    failure: query.isError ? failureOf(query.error, GET_RESOURCE_POLICY) : undefined,
    loading: query.isPending,
    refresh: () => void query.refetch(),
  };
}

/** Refresh any mounted reads for this target and mark the other affected reads stale. */
export function useRefreshSecretReads() {
  const client = useQueryClient();
  const refresh = (filters: QueryFilters) => {
    // A first read may have no cached result. Cancel it before invalidating so it cannot supply pre-write data.
    void client.cancelQueries({ ...filters, fetchStatus: 'fetching' });
    void client.invalidateQueries(filters);
  };
  return (endpoint: string, name: string, section?: 'versions' | 'policy') => {
    refresh({
      queryKey: [...SERVICE_KEY, LIST_SECRETS],
      // The listing appends endpoint before its mount and pagination fields.
      predicate: (query) =>
        query.queryKey.at(-5) === endpoint && failureOf(query.state.error, LIST_SECRETS).kind !== 'not-implemented',
    });
    refresh({
      queryKey: [...SERVICE_KEY, DESCRIBE_SECRET, endpoint, name],
      predicate: (query) => failureOf(query.state.error, DESCRIBE_SECRET).kind !== 'not-implemented',
    });
    if (section === 'versions') {
      refresh({
        queryKey: [...SERVICE_KEY, LIST_SECRET_VERSION_IDS, name],
        predicate: (query) =>
          query.queryKey.at(-5) === endpoint &&
          failureOf(query.state.error, LIST_SECRET_VERSION_IDS).kind !== 'not-implemented',
      });
    }
    if (section === 'policy') {
      refresh({
        queryKey: [...SERVICE_KEY, GET_RESOURCE_POLICY, endpoint, name],
        predicate: (query) => failureOf(query.state.error, GET_RESOURCE_POLICY).kind !== 'not-implemented',
      });
    }
  };
}
