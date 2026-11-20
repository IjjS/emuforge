import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { useReadAgain } from './queries';
import { createRouteTable, deleteRouteTable, type NewRouteTable } from './route-table-changes-api';

// The mutations of a route table (issue 574, design task 3). Once one succeeds, what it changed is read again: the
// route table lists (every filter, the route table that applies to a subnet among them) and that table; a failed one
// reads nothing again.

/** "Create route table": the new table's ID. */
export function useCreateRouteTable(
  endpoint: string | undefined,
): (table: NewRouteTable, signal: AbortSignal) => Promise<string> {
  const readAgain = useReadAgain();
  return useCallback(
    async (table: NewRouteTable, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createRouteTable(endpoint, table, signal);
      readAgain({ kind: 'route-table', id });
      return id;
    },
    [endpoint, readAgain],
  );
}

/** "Delete" of a route table. */
export function useDeleteRouteTable(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteRouteTable(endpoint, id, signal);
      readAgain({ kind: 'route-table', id });
    },
    [endpoint, readAgain],
  );
}
