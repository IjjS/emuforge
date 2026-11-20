import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { getRevision, type RevisionRead } from './definition-api';
import { DEFINITION_CHOICE_KEYS } from './definition-choices';
import { ECS_KEYS } from './queries';
import { registerTaskDefinition, type Registered } from './register-api';

// The hooks of S10, "Register task definition" (issue 575, design task 4): the one read of `from`, to fill the field,
// and the register, which reads again by s1's roots what it changed: S7's families, S8's revisions of the family, and
// the family and revision choices. A read of the registered revision that is out is cancelled and what is held of it
// removed, so its page opens with nothing of before beside the flash. A refusal changes nothing held.

/** A revision `from` names: `family:revision`, the revision a whole number from 1. */
export interface FromRevision {
  family: string;
  revision: number;
}

/** `from` as a revision; `undefined` when it names none. */
export function fromRevisionOf(from: string): FromRevision | undefined {
  const colon = from.lastIndexOf(':');
  if (colon <= 0) {
    return undefined;
  }
  const number = from.slice(colon + 1);
  if (!/^\d+$/.test(number) || Number(number) < 1) {
    return undefined;
  }
  return { family: from.slice(0, colon), revision: Number(number) };
}

/** What the read of `from` came to: its revision, or `undefined` once it could not be read. */
export interface FromRead {
  /** The read is out, or waits for the engine's address. */
  loading: boolean;
  /** The revision's answer; `undefined` while it is read, and when it could not be read. */
  value: RevisionRead | undefined;
  /** The read failed: the starter is shown instead. */
  failed: boolean;
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** The one read of the revision `from` names, on mount; none for `undefined`. */
export function useFromRevision(endpoint: string | undefined, from: FromRevision | undefined): FromRead {
  const [mount] = useState(() => (mounts += 1));
  const query = useQuery({
    queryKey: [...ECS_KEYS.revision(from?.family ?? '', from?.revision ?? 0), 'from', endpoint, mount],
    queryFn: ({ signal }) =>
      endpoint === undefined || from === undefined
        ? noEndpoint()
        : getRevision(endpoint, from.family, from.revision, signal),
    enabled: endpoint !== undefined && from !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  if (from === undefined) {
    return { loading: false, value: undefined, failed: false };
  }
  return {
    loading: endpoint === undefined || query.isPending,
    value: query.isSuccess ? query.data : undefined,
    failed: query.isError || (query.isSuccess && !query.data.found),
  };
}

/**
 * Registers `input` and answers the revision registered. Once it succeeds, a read of that revision that is out is
 * cancelled and what is held of it removed; then the families' list, the family's revisions and the family and
 * revision choices are read again, each by its root.
 */
export function useRegisterTaskDefinition(
  endpoint: string | undefined,
): (input: Record<string, unknown>, signal: AbortSignal) => Promise<Registered> {
  const client = useQueryClient();
  return useCallback(
    async (input: Record<string, unknown>, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const registered = await registerTaskDefinition(endpoint, input, signal);
      const revisionKey = ECS_KEYS.revision(registered.family, registered.revision);
      await client.cancelQueries({ queryKey: revisionKey });
      client.removeQueries({ queryKey: revisionKey });
      void client.invalidateQueries({ queryKey: ECS_KEYS.families() });
      void client.invalidateQueries({ queryKey: ECS_KEYS.familyRevisions(registered.family) });
      void client.invalidateQueries({ queryKey: DEFINITION_CHOICE_KEYS.families });
      void client.invalidateQueries({ queryKey: DEFINITION_CHOICE_KEYS.revisions });
      return registered;
    },
    [endpoint, client],
  );
}
