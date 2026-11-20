import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { createCluster, createInstance, type NewCluster, type NewInstance } from './create-api';
import { RDS_KEYS } from './queries';

// The creates of S2 and S5 as hooks (issue 573, design tasks 2 and 4): once `CreateDBInstance` succeeds the instance
// lists are read again, once `CreateDBCluster` succeeds the cluster lists; a create that failed changed nothing, and
// nothing is read again. Each is a plain call, not a TanStack mutation: the app's mutation cache never holds the
// values sent, so no retained state of the app keeps the password once the form is left.

/** Creates the DB instance `values` and answers its identifier. */
export function useCreateInstance(
  endpoint: string | undefined,
): (values: NewInstance, signal: AbortSignal) => Promise<string> {
  const client = useQueryClient();
  return useCallback(
    async (values: NewInstance, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createInstance(endpoint, values, signal);
      void client.invalidateQueries({ queryKey: RDS_KEYS.instances() });
      return id;
    },
    [endpoint, client],
  );
}

/** Creates the DB cluster `values` and answers its identifier. */
export function useCreateCluster(
  endpoint: string | undefined,
): (values: NewCluster, signal: AbortSignal) => Promise<string> {
  const client = useQueryClient();
  return useCallback(
    async (values: NewCluster, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createCluster(endpoint, values, signal);
      void client.invalidateQueries({ queryKey: RDS_KEYS.clusters() });
      return id;
    },
    [endpoint, client],
  );
}
