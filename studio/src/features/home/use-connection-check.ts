import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { loadConfig } from '../../app/config';
import { createEngineClient, type CheckResult } from '../../lib/engine/engine-client';

/** Home checks again this long after each answer while it is open (requirement 3.4). */
export const RECHECK_MS = 5_000;

export interface ConnectionCheck {
  /** The engine port from Studio's server; `undefined` until the page's configuration is read. */
  enginePort: number | undefined;
  /** `http://127.0.0.1:<engine port>`; `undefined` likewise. */
  engineOrigin: string | undefined;
  /** The answer to the latest completed check; `undefined` while the first is in flight. */
  result: CheckResult | undefined;
  /** A check is in flight. */
  checking: boolean;
  /** Starts a check at once; one in flight is dropped, so its late answer never replaces this one's. */
  refresh: () => void;
}

/**
 * The connection checks of Home: one on load, one 5 seconds after each answer, and one on "Refresh", for as long as
 * the component is mounted. Each check is new requests; no answer is kept for a later mount.
 */
export function useConnectionCheck(): ConnectionCheck {
  const config = useQuery({ queryKey: ['studio', 'config'], queryFn: loadConfig, staleTime: Infinity });
  const enginePort = config.data?.enginePort;
  // One client, so one session token, per mount of Home and engine port.
  const client = useMemo(() => (enginePort === undefined ? undefined : createEngineClient(enginePort)), [enginePort]);

  const check = useQuery({
    queryKey: ['engine', 'connection-check', enginePort],
    queryFn: ({ signal }) => {
      if (client === undefined) {
        throw new Error('The engine port is not known yet.');
      }
      return client.check(signal);
    },
    enabled: client !== undefined,
    staleTime: 0,
    gcTime: 0,
    structuralSharing: false,
  });
  const { refetch, isFetching, dataUpdatedAt } = check;

  useEffect(() => {
    if (client === undefined || isFetching) {
      return;
    }
    const timer = setTimeout(() => void refetch({ cancelRefetch: false }), RECHECK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [client, isFetching, dataUpdatedAt, refetch]);

  const refresh = useCallback(() => {
    if (client !== undefined) {
      void refetch({ cancelRefetch: true });
    }
  }, [client, refetch]);

  return {
    enginePort,
    engineOrigin: client?.origin,
    result: check.data,
    checking: isFetching || client === undefined,
    refresh,
  };
}
