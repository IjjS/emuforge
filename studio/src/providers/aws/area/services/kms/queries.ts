import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import type { AreaConnection } from '../../components/emulator-line';
import { failureOf, noEndpoint, useTokenListing } from '../../components/use-token-listing';
import { describeKey, KMS_OPERATIONS, listCustomerKeys } from './api';

export const KMS_KEYS = {
  list: ['kms', 'keys'],
  detail: (keyId: string) => ['kms', 'key', keyId],
};

export function useCustomerKeys(endpoint: string | undefined, enabled: boolean, generation: number) {
  return useTokenListing({
    key: [...KMS_KEYS.list, generation],
    endpoint,
    enabled,
    operation: KMS_OPERATIONS.listKeys,
    read: listCustomerKeys,
  });
}

let visits = 0;

export function useKmsKey(endpoint: string | undefined, keyId: string, enabled: boolean) {
  const [visit] = useState(() => (visits += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...KMS_KEYS.detail(keyId), endpoint, visit, generation],
    queryFn: ({ signal }) => describeKey(endpoint ?? noEndpoint(), keyId, signal),
    enabled: enabled && endpoint !== undefined,
    retry: false,
    gcTime: 0,
  });
  return {
    key: query.isError ? undefined : query.data,
    failure: query.isError ? failureOf(query.error, KMS_OPERATIONS.describeKey) : undefined,
    refresh: () => setGeneration((current) => current + 1),
  };
}

/** A connection failure reported by the frame before the page issues a read. */
export function connectionFailure(connection: AreaConnection, operation: string): RequestFailure | undefined {
  switch (connection.result?.kind) {
    case 'engine-unreachable':
      return { kind: 'engine-did-not-answer', operation };
    case 'emulator-unreachable':
      return { kind: 'emulator-did-not-answer', operation, message: connection.result.message };
    case 'engine-error':
      return {
        kind: 'other',
        operation,
        code: connection.result.code ?? `HTTP ${String(connection.result.status)}`,
      };
    default:
      return undefined;
  }
}
