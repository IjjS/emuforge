import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  refusalMessage,
  requestFailure,
  type RequestFailure,
} from '../../../../../lib/aws/request';
import { actionFailureItem } from '../../components/failure-states';
import { usePageFlash } from '../../components/page-flash';
import { noEndpoint } from '../../components/use-token-listing';
import { OPERATIONS } from './api';
import {
  changeInstanceContent,
  contentOperation,
  getInstanceUserData,
  type InstanceContentChange,
  type InstanceUserData,
} from './instance-content-api';
import { EC2_KEYS, type Ec2Read } from './queries';

export function useInstanceUserData(endpoint: string | undefined, id: string): Ec2Read<InstanceUserData> {
  const opening = useId();
  const query = useQuery({
    queryKey: EC2_KEYS.instance(id, 'user-data', endpoint, opening),
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getInstanceUserData(endpoint, id, signal)),
    enabled: endpoint !== undefined,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    value: query.isError || query.isFetching ? undefined : query.data,
    failure:
      query.isError && !query.isFetching
        ? requestFailure(OPERATIONS.describeInstanceAttribute, query.error)
        : undefined,
    loading: endpoint === undefined || query.isFetching,
    refresh: () => {
      void query.refetch();
    },
  };
}

function contentFailureItem(failure: RequestFailure, label: string, endpoint: string) {
  const item = actionFailureItem(failure, label, endpoint);
  if (failure.kind === 'not-implemented') {
    const detail = reportedNotImplementedMessage(failure);
    const explanation = typeof item.content === 'string' ? item.content : undefined;
    return { ...item, content: [`${label}.`, explanation, detail].filter(Boolean).join(' ') };
  }
  if (failure.kind === 'other' || failure.kind === 'access-denied') {
    const code = reportedServiceCode(failure) ?? (failure.kind === 'other' ? failure.code : undefined);
    const detail = [code, refusalMessage(failure)].filter(Boolean).join(': ');
    const refused = failure.kind === 'access-denied' ? `${label}. ${failure.operation} was refused.` : '';
    return { ...item, content: [refused, detail].filter(Boolean).join(' ') };
  }
  return item;
}

export function useInstanceContentChange(endpoint: string | undefined, id: string) {
  const client = useQueryClient();
  const flash = usePageFlash();
  const active = useRef<AbortController | undefined>(undefined);
  const [pending, setPending] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  const save = async (
    change: InstanceContentChange,
    {
      label,
      result,
      onSettled,
    }: {
      label: string;
      result: string;
      onSettled: (failure?: RequestFailure) => void;
    },
  ) => {
    if (active.current !== undefined || endpoint === undefined) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    try {
      await changeInstanceContent(endpoint, id, change, controller.signal);
      if (controller.signal.aborted) return;

      flash.show([{ type: 'success', content: result }]);
      onSettled();
      const lists = { queryKey: EC2_KEYS.instances() };
      const detail = { queryKey: EC2_KEYS.instance(id) };
      // Cancel even an initial read without cached data before invalidating it.
      await Promise.all([client.cancelQueries(lists), client.cancelQueries(detail)]);
      void client.invalidateQueries(lists);
      void client.invalidateQueries(detail);
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = requestFailure(contentOperation(change), error);
      flash.show([contentFailureItem(failure, label, endpoint)]);
      onSettled(failure);
    } finally {
      if (!controller.signal.aborted) {
        active.current = undefined;
        setPending(false);
      }
    }
  };

  return { pending, save, canDismiss: () => active.current === undefined };
}
