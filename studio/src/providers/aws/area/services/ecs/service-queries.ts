import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import { FOLLOW_MS, followsService } from './follow';
import { ECS_KEYS, type EcsRead } from './queries';
import { getService, listServices, SERVICE_OPERATIONS, type Service, type ServiceRead } from './service-api';

// The TanStack Query hooks of a cluster's services (issue 575, design task 1), every key under s1's root of the
// cluster's services, so a change of a service reads them again by that root. Every read is a request of its own on
// every mount, "Refresh" and "Retry"; a read no longer wanted is aborted, and its late answer, under a key nobody
// shows any more, changes nothing shown. A followed part (`follow.ts`) is read again every 3 seconds in place.

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** The key of the services table's listing; the listing adds the page's token. */
export function servicesKey(cluster: string): unknown[] {
  return ECS_KEYS.clusterServices(cluster, 'list');
}

/** The key of the service `name`'s reads. */
export function serviceKey(cluster: string, name: string, ...parts: unknown[]): unknown[] {
  return ECS_KEYS.clusterServices(cluster, 'service', name, ...parts);
}

/**
 * The services table: a page of `ListServices` and `DescribeServices` at a time on the API's own tokens. While a
 * service of the page is followed (`followsService`) the page is read again every 3 seconds with the same token.
 */
export function useServiceListing(
  endpoint: string | undefined,
  cluster: string,
  enabled = true,
): TokenListing<Service> {
  return useTokenListing({
    key: servicesKey(cluster),
    endpoint,
    enabled,
    operation: SERVICE_OPERATIONS.listServices,
    read: async (at, token, signal) => {
      const page = await listServices(at, cluster, token, signal);
      return page.nextToken === undefined ? { items: page.services } : { items: page.services, next: page.nextToken };
    },
    readAgainAfter: (services) => (services.some(followsService) ? FOLLOW_MS : false),
  });
}

/** S4's read of the service `name`, read again every 3 seconds while it is followed; nothing is read until `enabled`. */
export function useService(
  endpoint: string | undefined,
  cluster: string,
  name: string,
  enabled = true,
): EcsRead<ServiceRead> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...serviceKey(cluster, name), endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getService(endpoint, cluster, name, signal)),
    enabled: enabled && endpoint !== undefined,
    refetchInterval: (current) => {
      const read = current.state.data;
      return current.state.status !== 'error' && read?.found === true && followsService(read.service)
        ? FOLLOW_MS
        : false;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, SERVICE_OPERATIONS.describeServices) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}
