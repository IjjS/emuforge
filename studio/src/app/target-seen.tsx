import { useQueryClient, type Query } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * The key prefixes of Studio's own queries (its configuration, the engine's checks): kept on a change of target.
 * Every other query is a provider area's, and is dropped.
 */
const STUDIO_PREFIXES: ReadonlySet<unknown> = new Set(['studio', 'engine']);

/** What the document has seen of the target (issue 486, R3). Not stored: a reload starts without one. */
export interface TargetSeen {
  /** The target's name from the latest answer that named one; `undefined` before the first. */
  name: string | undefined;
  /** How many changes of target the document has seen: `0` until the first change. */
  generation: number;
  /**
   * Reports an answer naming `name`, to a request that started at `startedAt` (milliseconds since the epoch). Ignored
   * when `name` is `undefined` or the request started before the one whose answer last set the target seen. Returns
   * the generation after the report.
   */
  report: (name: string | undefined, startedAt: number) => number;
}

const NOTHING_SEEN: TargetSeen = { name: undefined, generation: 0, report: () => 0 };

const TargetSeenContext = createContext<TargetSeen>(NOTHING_SEEN);

function isProviderQuery(query: Query): boolean {
  return !STUDIO_PREFIXES.has(query.queryKey[0]);
}

interface Held {
  name: string | undefined;
  startedAt: number;
  generation: number;
}

/**
 * Holds the document's target seen, below the app's query client. A report naming another target than the one held
 * cancels and then removes every query of that client that is not Studio's own, so nothing a provider area cached
 * from the earlier target is shown again and no request of it in flight reaches the cache.
 */
export function TargetSeenProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Read and written by `report` at once, so reports in the same render are ordered without waiting for React.
  const held = useRef<Held>({ name: undefined, startedAt: -Infinity, generation: 0 });
  const [shown, setShown] = useState<{ name: string | undefined; generation: number }>({
    name: undefined,
    generation: 0,
  });

  const report = useCallback(
    (name: string | undefined, startedAt: number): number => {
      const now = held.current;
      if (name === undefined || startedAt < now.startedAt) {
        return now.generation;
      }
      const changed = now.name !== undefined && now.name !== name;
      const next = { name, startedAt, generation: changed ? now.generation + 1 : now.generation };
      held.current = next;
      if (changed) {
        void queryClient.cancelQueries({ predicate: isProviderQuery });
        queryClient.removeQueries({ predicate: isProviderQuery });
      }
      if (now.name !== name) {
        setShown({ name: next.name, generation: next.generation });
      }
      return next.generation;
    },
    [queryClient],
  );

  const value = useMemo(() => ({ ...shown, report }), [shown, report]);
  return <TargetSeenContext value={value}>{children}</TargetSeenContext>;
}

/** The document's target seen. Outside `TargetSeenProvider`: nothing seen, and reports are ignored. */
// eslint-disable-next-line react-refresh/only-export-components -- the target seen and its provider are one module (breakdown s1)
export function useTargetSeen(): TargetSeen {
  return useContext(TargetSeenContext);
}
