import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { useReadAgain } from './queries';
import { createVpc, deleteVpc, type NewVpc } from './vpc-changes-api';

// The mutations of a VPC (issue 574, design task 2). Once one succeeds, what it changed is read again: the VPC lists,
// that VPC, the VPC choices and the route table lists; a failed one reads nothing again.

/** "Create VPC": the new VPC's ID. */
export function useCreateVpc(endpoint: string | undefined): (vpc: NewVpc, signal: AbortSignal) => Promise<string> {
  const readAgain = useReadAgain();
  return useCallback(
    async (vpc: NewVpc, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createVpc(endpoint, vpc, signal);
      readAgain({ kind: 'vpc', id });
      return id;
    },
    [endpoint, readAgain],
  );
}

/** "Delete" of a VPC. */
export function useDeleteVpc(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadAgain();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteVpc(endpoint, id, signal);
      readAgain({ kind: 'vpc', id });
    },
    [endpoint, readAgain],
  );
}
