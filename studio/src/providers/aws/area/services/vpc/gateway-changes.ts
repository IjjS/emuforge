import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import {
  attachInternetGateway,
  createInternetGateway,
  deleteInternetGateway,
  detachInternetGateway,
  type NewGateway,
} from './gateway-changes-api';
import { useReadAgain } from './queries';

// The mutations of an internet gateway (issue 574, design task 3). Once one succeeds, what it changed is read again:
// the gateway lists (every filter) and that gateway, and after a detach the route tables too, whose routes to it turn
// `blackhole`; a failed one reads nothing again.

/** "Create internet gateway": the new gateway's ID. */
export function useCreateGateway(
  endpoint: string | undefined,
): (gateway: NewGateway, signal: AbortSignal) => Promise<string> {
  const readAgain = useReadAgain();
  return useCallback(
    async (gateway: NewGateway, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createInternetGateway(endpoint, gateway, signal);
      readAgain({ kind: 'gateway', id });
      return id;
    },
    [endpoint, readAgain],
  );
}

/** "Attach" of a gateway to a VPC. */
export function useAttachGateway(
  endpoint: string | undefined,
): (id: string, vpcId: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, vpcId: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await attachInternetGateway(endpoint, id, vpcId, signal);
      readAgain({ kind: 'gateway', id });
    },
    [endpoint, readAgain],
  );
}

/** "Detach" of a gateway from the VPC of its attachment. */
export function useDetachGateway(
  endpoint: string | undefined,
): (id: string, vpcId: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, vpcId: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await detachInternetGateway(endpoint, id, vpcId, signal);
      readAgain({ kind: 'gateway', id, detached: true });
    },
    [endpoint, readAgain],
  );
}

/** "Delete" of a gateway. */
export function useDeleteGateway(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteInternetGateway(endpoint, id, signal);
      readAgain({ kind: 'gateway', id });
    },
    [endpoint, readAgain],
  );
}
