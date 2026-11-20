import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { useReadAgain, VPC_KEY } from './queries';
import {
  createSubnet,
  deleteSubnet,
  listAvailabilityZones,
  setPublicAddresses,
  SUBNET_CHANGE_OPERATIONS,
  type NewSubnet,
} from './subnet-changes-api';

// The mutations of a subnet (issue 574, design task 2), and the create form's own read of the Availability Zones.
// Once a change succeeds, what it changed is read again (design, "Where a result is shown"): after a create the
// subnet lists, that subnet and the subnet choices; after a delete those and the route tables; after a change of the
// public addresses that subnet and the subnet lists. A failed one reads nothing again.

/** S5's zones: their names, a failure, and "Retry". */
export interface ZonesRead {
  zones: string[] | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  retry: () => void;
}

/** A number per mount, so a read of an earlier opening is never shown. */
let mounts = 0;

/** One `DescribeAvailabilityZones` on each opening of the form and each "Retry"; a failure never fails the form. */
export function useAvailabilityZones(endpoint: string | undefined): ZonesRead {
  const [generation, setGeneration] = useState(0);
  const [mount] = useState(() => (mounts += 1));
  const query = useQuery({
    queryKey: [...VPC_KEY, 'availability-zones', endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : listAvailabilityZones(endpoint, signal)),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const retry = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    zones: query.isError ? undefined : query.data,
    failure: query.isError ? failureOf(query.error, SUBNET_CHANGE_OPERATIONS.describeAvailabilityZones) : undefined,
    loading: !query.isError && query.data === undefined,
    retry,
  };
}

/** "Create subnet": the new subnet's ID. */
export function useCreateSubnet(
  endpoint: string | undefined,
): (subnet: NewSubnet, signal: AbortSignal) => Promise<string> {
  const readAgain = useReadAgain();
  return useCallback(
    async (subnet: NewSubnet, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createSubnet(endpoint, subnet, signal);
      readAgain({ kind: 'subnet', id });
      return id;
    },
    [endpoint, readAgain],
  );
}

/** "Turn on" / "Turn off" of a subnet's public IPv4 addresses on launch. */
export function useSetPublicAddresses(
  endpoint: string | undefined,
): (id: string, on: boolean, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, on: boolean, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await setPublicAddresses(endpoint, id, on, signal);
      readAgain({ kind: 'subnet-addresses', id });
    },
    [endpoint, readAgain],
  );
}

/** "Delete" of a subnet. */
export function useDeleteSubnet(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteSubnet(endpoint, id, signal);
      readAgain({ kind: 'subnet', id, deleted: true });
    },
    [endpoint, readAgain],
  );
}
