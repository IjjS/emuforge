import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  refusalMessage,
  requestFailure,
  type RequestFailure,
} from '../../../../../lib/aws/request';
import { actionFailureItem } from '../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../components/page-flash';
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

type ContentEditor = 'tags' | 'user-data';

interface ContentResult {
  label: string;
  result: string;
  onSettled: () => void;
}

export type InstanceContentWrites = ReturnType<typeof useInstanceContentChange>;

/** The visit owns pending writes, even while the detail read removes their editors. */
export function useInstanceContentChange(endpoint: string | undefined, id: string, pageSignal: () => AbortSignal) {
  const client = useQueryClient();
  const flash = usePageFlash();
  const active = useRef(new Set<ContentEditor>());
  const [pending, setPending] = useState<ReadonlySet<ContentEditor>>(new Set());
  const [unsupported, setUnsupported] = useState<Partial<Record<string, RequestFailure>>>({});

  const save = async (
    change: InstanceContentChange,
    { label, result, onSettled, onRefusal }: ContentResult & { onRefusal?: (item: FlashItem) => boolean },
  ) => {
    const editor = change.kind === 'user-data' ? 'user-data' : 'tags';
    if (active.current.has(editor) || endpoint === undefined) return;
    const signal = pageSignal();
    active.current.add(editor);
    setPending(new Set(active.current));
    try {
      await changeInstanceContent(endpoint, id, change, signal);
      if (signal.aborted) return;

      flash.show([{ type: 'success', content: result }]);
      onSettled();
      const lists = { queryKey: EC2_KEYS.instances() };
      const detail = { queryKey: EC2_KEYS.instance(id) };
      // Cancel even an initial read without cached data before invalidating it.
      await Promise.all([client.cancelQueries(lists), client.cancelQueries(detail)]);
      if (signal.aborted) return;
      void client.invalidateQueries(lists);
      void client.invalidateQueries(detail);
    } catch (error) {
      if (signal.aborted) return;
      const failure = requestFailure(contentOperation(change), error);
      const item = contentFailureItem(failure, label, endpoint);
      if (failure.kind === 'not-implemented') {
        setUnsupported((previous) => ({ ...previous, [failure.operation]: failure }));
        flash.show([item]);
        onSettled();
      } else {
        const announcedInDialog = onRefusal?.(item) === true;
        flash.show([announcedInDialog ? { ...item, announcedInDialog: true } : item]);
      }
    } finally {
      active.current.delete(editor);
      if (!signal.aborted) setPending(new Set(active.current));
    }
  };

  return { pending, unsupported, save, isPending: (editor: ContentEditor) => active.current.has(editor) };
}

/** Only the inline copy of a refusal and closing the dialog depend on the editor still being mounted. */
export function useInstanceContentEditor(writes: InstanceContentWrites, editor: ContentEditor) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [refusal, setRefusal] = useState<FlashItem>();

  const submit = (change: InstanceContentChange, result: ContentResult) => {
    if (writes.isPending(editor)) return;
    setRefusal(undefined);
    void writes.save(change, {
      ...result,
      onSettled: () => {
        if (mounted.current) result.onSettled();
      },
      onRefusal: (item) => {
        if (!mounted.current) return false;
        setRefusal(item);
        return true;
      },
    });
  };

  return {
    pending: writes.pending.has(editor),
    refusal,
    submit,
    canDismiss: () => !writes.isPending(editor),
    clearRefusal: () => setRefusal(undefined),
  };
}
