// The connections page's reads (issue 486, R1): the engine's list of connections and each one's info, under
// Studio's own key prefix `'studio'`, so a change of target never drops them. Infos are read at most 4 at a time, in
// the list's order.

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { engineBase, loadConfig } from '../../app/config';
import {
  createTargetsClient,
  type TargetInfo,
  type TargetList,
  type TargetsClient,
} from '../../lib/engine/targets-client';

/** At most this many infos are in flight at once, well under the engine's in-flight bound of 32. */
export const INFO_LIMIT = 4;

/** The key of the page's list of connections, by engine port. */
export function listKey(enginePort: number | undefined): readonly unknown[] {
  return ['studio', 'connections', 'list', enginePort];
}

/** Runs tasks at most `limit` at a time, starting them in the order they were asked for. */
export interface Limiter {
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

export function createLimiter(limit: number): Limiter {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    if (running < limit) {
      waiting.shift()?.();
    }
  };
  return {
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', drop);
          running += 1;
          task()
            .then(resolve, reject)
            .finally(() => {
              running -= 1;
              next();
            });
        };
        // A task aborted while it waits leaves the queue and never starts.
        const drop = () => {
          const at = waiting.indexOf(start);
          if (at !== -1) {
            waiting.splice(at, 1);
          }
          reject(signal.reason);
        };
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', drop, { once: true });
        waiting.push(start);
        next();
      });
    },
  };
}

export interface TargetsAccess {
  /** The engine's targets client; `undefined` until the page's configuration is read. */
  client: TargetsClient | undefined;
  enginePort: number | undefined;
}

/** The targets client of the engine Studio's configuration names: one per mount and engine address, so one session. */
export function useTargetsClient(): TargetsAccess {
  const config = useQuery({ queryKey: ['studio', 'config'], queryFn: loadConfig, staleTime: Infinity });
  const enginePort = config.data?.enginePort;
  const base = config.data === undefined ? undefined : engineBase(config.data, window.location.origin);
  const client = useMemo(() => (base === undefined ? undefined : createTargetsClient(base)), [base]);
  return { client, enginePort };
}

/** The engine's list of connections; read on mount and whenever the page asks again. */
export function useConnectionList({ client, enginePort }: TargetsAccess): UseQueryResult<TargetList> {
  return useQuery({
    queryKey: listKey(enginePort),
    queryFn: ({ signal }) => {
      if (client === undefined) {
        throw new Error('The engine port is not known yet.');
      }
      return client.list(signal);
    },
    enabled: client !== undefined,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Each connection's info, read once for each reading of the list (`reading`, when that list was read), at most
 * `INFO_LIMIT` at a time, in the list's order. A failed info is that row's alone.
 */
export function useConnectionInfos(
  client: TargetsClient | undefined,
  names: readonly string[],
  reading: number,
): UseQueryResult<TargetInfo>[] {
  const [limiter] = useState(() => createLimiter(INFO_LIMIT));
  return useQueries({
    queries: names.map((name) => ({
      queryKey: ['studio', 'connections', 'info', reading, name],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (client === undefined) {
          throw new Error('The engine port is not known yet.');
        }
        return limiter.run(() => client.info(name, signal), signal);
      },
      enabled: client !== undefined && reading > 0,
      staleTime: Infinity,
      gcTime: 0,
    })),
  });
}
