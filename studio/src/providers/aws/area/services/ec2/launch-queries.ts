import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { launchInstance, type NewInstance } from './launch-api';
import { EC2_KEYS } from './queries';

// The launch of S2 as a hook (issue 553, design task 2): once `RunInstances` succeeds, the instance lists are read
// again, so S1 shows the new instance; a launch that failed changed nothing, and nothing is read again.

/** Launches `launch` and answers the new instance's ID. */
export function useLaunchInstance(
  endpoint: string | undefined,
): (launch: NewInstance, signal: AbortSignal) => Promise<string> {
  const client = useQueryClient();
  return useCallback(
    async (launch: NewInstance, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await launchInstance(endpoint, launch, signal);
      void client.invalidateQueries({ queryKey: EC2_KEYS.instances() });
      return id;
    },
    [endpoint, client],
  );
}
