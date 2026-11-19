import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { engineBase, loadConfig } from '../../app/config';
import { useTargetSeen } from '../../app/target-seen';
import { createEngineClient, startedAtOf, targetOf, type CheckResult } from '../../lib/engine/engine-client';

/** Home checks again this long after each answer while it is open (requirement 3.4). */
export const RECHECK_MS = 5_000;

export interface ConnectionCheck {
  /** The engine port from Studio's server; `undefined` until the page's configuration is read. */
  enginePort: number | undefined;
  /**
   * The engine's address the page calls: `http://127.0.0.1:<engine port>`, or `<page origin><engine path>` when
   * Studio's server names a channel; `undefined` likewise.
   */
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
 *
 * Each answer that names a target is reported to the document's target seen, with the time its check started. When
 * the target seen changes by another report (another check, the connections page), it checks at once, dropping the
 * check in flight; a change its own answer made needs no further check.
 */
export function useConnectionCheck(): ConnectionCheck {
  const config = useQuery({ queryKey: ['studio', 'config'], queryFn: loadConfig, staleTime: Infinity });
  const enginePort = config.data?.enginePort;
  const base = config.data === undefined ? undefined : engineBase(config.data, window.location.origin);
  // One client, so one session token, per mount of Home and engine address.
  const client = useMemo(() => (base === undefined ? undefined : createEngineClient(base)), [base]);

  const check = useQuery({
    queryKey: ['engine', 'connection-check', base],
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
  const result = check.data;
  const { generation, report } = useTargetSeen();
  // The generation this hook has seen or caused; a different one is a change made by another report.
  const known = useRef(generation);

  useEffect(() => {
    const target = result === undefined ? undefined : targetOf(result);
    if (result !== undefined && target !== undefined) {
      known.current = report(target, startedAtOf(result));
    }
  }, [result, report]);

  useEffect(() => {
    if (generation === known.current) {
      return;
    }
    known.current = generation;
    if (client !== undefined) {
      void refetch({ cancelRefetch: true });
    }
  }, [generation, client, refetch]);

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
    result,
    checking: isFetching || client === undefined,
    refresh,
  };
}
