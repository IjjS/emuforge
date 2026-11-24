import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { modifyInstanceAttribute, type InstanceAttributeChange } from './instance-attribute-api';
import { EC2_KEYS } from './queries';

export function useInstanceAttributeChange(endpoint: string | undefined, id: string) {
  const client = useQueryClient();

  return useCallback(
    async (change: InstanceAttributeChange, signal: AbortSignal) => {
      if (endpoint === undefined) noEndpoint();
      await modifyInstanceAttribute(endpoint, id, change, signal);
      if (signal.aborted) return;

      // An initial read with no cached value would otherwise be shared with the invalidation.
      const lists = { queryKey: EC2_KEYS.instances() };
      const detail = { queryKey: EC2_KEYS.instance(id) };
      await Promise.all([client.cancelQueries(lists), client.cancelQueries(detail)]);
      if (signal.aborted) return;
      void client.invalidateQueries(lists);
      void client.invalidateQueries(detail);
    },
    [client, endpoint, id],
  );
}
