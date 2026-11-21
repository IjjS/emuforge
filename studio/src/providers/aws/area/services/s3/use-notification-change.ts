import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { requestFailure, type RequestFailure } from '../../../../../lib/aws/request';
import {
  getBucketNotificationConfiguration,
  NO_SUCH_BUCKET,
  OPERATIONS,
  putBucketNotificationConfiguration,
  type NotificationConfiguration,
  type NoSuchBucket,
} from './api';
import { replaceNotification, sameNotifications, type NotificationChange } from './notifications';

type Verification = {
  expected: NotificationConfiguration;
  observed?: NotificationConfiguration | NoSuchBucket;
  failure?: RequestFailure;
};

type ChangeState =
  | { kind: 'idle' | 'pending' | 'missing' | 'duplicate' | 'changed' }
  | { kind: 'failed'; stage: 'read' | 'write'; failure: RequestFailure }
  | ({ kind: 'unconfirmed' } & Verification);

/** The page owns this transaction through the final read, even when its form or section is temporarily absent. */
export function useNotificationChange(
  endpoint: string | undefined,
  bucket: string,
  onVerified: () => void,
  onUnconfirmedRead?: (value: NotificationConfiguration | NoSuchBucket) => void,
) {
  const [state, setState] = useState<ChangeState>({ kind: 'idle' });
  const active = useRef<AbortController | undefined>(undefined);
  const client = useQueryClient();
  useLayoutEffect(
    () => () => {
      const operation = active.current;
      active.current = undefined;
      operation?.abort();
    },
    [endpoint, bucket],
  );

  async function run(change?: NotificationChange, retry?: Verification) {
    if (endpoint === undefined || active.current !== undefined) return;
    const operation = new AbortController();
    const { signal } = operation;
    active.current = operation;
    setState({ kind: 'pending' });
    let expected = retry?.expected;
    let stage: 'read' | 'write' = 'read';

    try {
      if (change !== undefined) {
        const fresh = await getBucketNotificationConfiguration(endpoint, bucket, signal);
        if (signal.aborted) return;
        if (fresh === NO_SUCH_BUCKET) {
          setState({ kind: 'missing' });
          return;
        }
        const replacement = replaceNotification(fresh, change);
        if ('problem' in replacement) {
          setState({ kind: replacement.problem });
          return;
        }
        stage = 'write';
        const result = await putBucketNotificationConfiguration(endpoint, bucket, replacement.configuration, signal);
        if (signal.aborted) return;
        if (result === NO_SUCH_BUCKET) {
          setState({ kind: 'missing' });
          return;
        }
        expected = replacement.configuration;
        void client.invalidateQueries({
          queryKey: ['aws', 's3', 'bucket', bucket, 'notifications'],
          refetchType: 'none',
        });
      }

      if (expected === undefined) return;
      const observed = await getBucketNotificationConfiguration(endpoint, bucket, signal);
      if (signal.aborted) return;
      if (observed === NO_SUCH_BUCKET || !sameNotifications(expected, observed)) {
        setState({ kind: 'unconfirmed', expected, observed });
        onUnconfirmedRead?.(observed);
        return;
      }
      setState({ kind: 'idle' });
      onVerified();
    } catch (error) {
      if (signal.aborted) return;
      const operationName =
        expected === undefined && stage === 'write'
          ? OPERATIONS.putBucketNotificationConfiguration
          : OPERATIONS.getBucketNotificationConfiguration;
      const failure = requestFailure(operationName, error);
      setState(
        expected === undefined ? { kind: 'failed', stage, failure } : { kind: 'unconfirmed', expected, failure },
      );
    } finally {
      if (active.current === operation) active.current = undefined;
    }
  }

  const unsupported = state.kind === 'failed' && state.failure.kind === 'not-implemented';
  return {
    state,
    pending: state.kind === 'pending',
    unsupported,
    readFailed: state.kind === 'failed' && state.stage === 'read',
    locked: state.kind === 'pending' || state.kind === 'unconfirmed' || unsupported,
    submit: (change: NotificationChange) => void run(change),
    checkAgain: () => {
      if (state.kind === 'unconfirmed') void run(undefined, state);
    },
    clear: () => setState({ kind: 'idle' }),
  };
}

export type NotificationChangeControl = ReturnType<typeof useNotificationChange>;
