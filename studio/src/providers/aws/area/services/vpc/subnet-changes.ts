import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { useReadAgain } from './queries';
import {
  createSubnet,
  deleteSubnet,
  setPublicAddresses,
  SUBNET_CHANGE_OPERATIONS,
  type NewSubnet,
} from './subnet-changes-api';

// The mutations of a subnet (issue 574, design task 2), for the subnet forms.
// Once a change succeeds, what it changed is read again (design, "Where a result is shown"): after a create the
// subnet lists, that subnet and the subnet choices; after a delete those and the route tables; after a change of the
// public addresses that subnet and the subnet lists. A failed one reads nothing again.

export { useAvailabilityZones, type ZonesRead } from '../../components/use-availability-zones';

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
