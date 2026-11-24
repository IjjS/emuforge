import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { requestFailure, type RequestFailure } from '../../../../../lib/aws/request';
import { noEndpoint } from '../../components/use-token-listing';
import {
  MODIFY_INSTANCE_ATTRIBUTE,
  modifyInstanceAttribute,
  type InstanceAttributeChange,
} from './instance-attribute-api';
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

export type InstanceAttributeWrites = ReturnType<typeof useInstanceAttributeWrites>;

/** A submitted write belongs to the visit even if a fresh detail read removes its editor. */
export function useInstanceAttributeWrites(endpoint: string | undefined, id: string, pageSignal: () => AbortSignal) {
  type Kind = InstanceAttributeChange['kind'];
  const save = useInstanceAttributeChange(endpoint, id);
  const active = useRef(new Set<Kind>());
  const [pending, setPending] = useState<ReadonlySet<Kind>>(new Set());
  const [unsupported, setUnsupported] = useState<Partial<Record<Kind, RequestFailure>>>({});

  const submit = async (change: InstanceAttributeChange, onSettled: (failure?: RequestFailure) => void) => {
    const { kind } = change;
    if (endpoint === undefined || active.current.has(kind)) return;
    const signal = pageSignal();
    active.current.add(kind);
    setPending(new Set(active.current));
    let failure: RequestFailure | undefined;
    try {
      await save(change, signal);
    } catch (error) {
      failure = requestFailure(MODIFY_INSTANCE_ATTRIBUTE, error);
    } finally {
      active.current.delete(kind);
      if (!signal.aborted) setPending(new Set(active.current));
    }
    if (signal.aborted) return;
    if (failure?.kind === 'not-implemented') {
      const refusal = failure;
      setUnsupported((previous) => ({ ...previous, [kind]: refusal }));
    }
    onSettled(failure);
  };

  return { pending, unsupported, submit };
}
