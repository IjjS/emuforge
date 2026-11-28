import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { listInternetGateways, READ_OPERATIONS } from './api';
import { VPC_KEYS } from './queries';

let mounts = 0;

async function readAttachments(endpoint: string, signal: AbortSignal) {
  const attachments = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await listInternetGateways(endpoint, {}, token, signal);
    for (const gateway of page.items) {
      if (gateway.vpcId !== undefined && !attachments.has(gateway.vpcId)) {
        attachments.set(gateway.vpcId, gateway.id);
      }
    }
    token = page.nextToken;
  } while (token !== undefined);
  return attachments;
}

/** A form sees only the gateway attachments from its latest read. */
export function useFreeVpcs(endpoint: string | undefined, enabled = true) {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: VPC_KEYS.choices('gateway-attachments', endpoint, mount, generation),
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : readAttachments(endpoint, signal)),
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const attachments = enabled && !query.isFetching && query.isSuccess ? query.data : undefined;
  const failure =
    enabled && query.isError ? failureOf(query.error, READ_OPERATIONS.describeInternetGateways) : undefined;
  return { attachments, failure, checking: enabled && attachments === undefined && failure === undefined, refresh };
}
