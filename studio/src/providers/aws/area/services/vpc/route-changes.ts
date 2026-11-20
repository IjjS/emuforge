import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { useReadAgain } from './queries';
import { associateSubnet, createRoute, deleteRoute, disassociateSubnet, type NewRoute } from './route-changes-api';

// The mutations of a route table's routes and associations (issue 574, design task 3). Once one succeeds, what it
// changed is read again: the route table lists (every filter, the route table that applies to a subnet among them)
// and that table; a failed one reads nothing again.

/** S10's "Add route". */
export function useAddRoute(endpoint: string | undefined): (route: NewRoute, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (route: NewRoute, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await createRoute(endpoint, route, signal);
      readAgain({ kind: 'route-table', id: route.routeTableId });
    },
    [endpoint, readAgain],
  );
}

/** S9's "Delete route", by the route's IPv4 destination. */
export function useDeleteRoute(
  endpoint: string | undefined,
): (routeTableId: string, destination: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (routeTableId: string, destination: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteRoute(endpoint, routeTableId, destination, signal);
      readAgain({ kind: 'route-table', id: routeTableId });
    },
    [endpoint, readAgain],
  );
}

/** S11's "Associate subnet": the association's ID. */
export function useAssociateSubnet(
  endpoint: string | undefined,
): (routeTableId: string, subnetId: string, signal: AbortSignal) => Promise<string> {
  const readAgain = useReadAgain();
  return useCallback(
    async (routeTableId: string, subnetId: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await associateSubnet(endpoint, routeTableId, subnetId, signal);
      readAgain({ kind: 'route-table', id: routeTableId });
      return id;
    },
    [endpoint, readAgain],
  );
}

/** S9's "Disassociate", by the association's ID, of the table `routeTableId`. */
export function useDisassociateSubnet(
  endpoint: string | undefined,
): (routeTableId: string, associationId: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (routeTableId: string, associationId: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await disassociateSubnet(endpoint, associationId, signal);
      readAgain({ kind: 'route-table', id: routeTableId });
    },
    [endpoint, readAgain],
  );
}
