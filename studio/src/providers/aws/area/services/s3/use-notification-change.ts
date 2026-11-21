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
  | { kind: 'idle' | 'missing' | 'duplicate' | 'changed' | 'interrupted' }
  | { kind: 'pending'; checkingAgain: boolean }
  | { kind: 'failed'; stage: 'read' | 'write'; failure: RequestFailure }
  | ({ kind: 'unconfirmed' } & Verification);

/** The page owns this transaction through the final read, even when its form or section is temporarily absent. */
export function useNotificationChange(
  endpoint: string | undefined,
  bucket: string,
  offline: boolean,
  onVerified: () => void,
  onUnconfirmedRead?: (value: NotificationConfiguration | NoSuchBucket) => void,
) {
  const [state, setState] = useState<ChangeState>({ kind: 'idle' });
  const active = useRef<{ cancel: () => void; interrupt: () => void } | undefined>(undefined);
  const client = useQueryClient();
  const [wasOffline, setWasOffline] = useState(offline);
  if (offline !== wasOffline) {
    setWasOffline(offline);
    if (offline && state.kind === 'unconfirmed' && state.observed !== undefined) {
      setState({ kind: 'unconfirmed', expected: state.expected });
    }
  }

  useLayoutEffect(() => () => active.current?.cancel(), [endpoint, bucket]);
  useLayoutEffect(() => {
    if (offline) active.current?.interrupt();
  }, [offline]);

  async function run(change?: NotificationChange, retry?: Verification) {
    if (offline || endpoint === undefined || active.current !== undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    let expected = retry?.expected;
    // Once the PUT starts, its outcome may be unknown even if the browser aborts the request.
    let attempted = expected;
    const operation = {
      cancel() {
        if (active.current === operation) active.current = undefined;
        controller.abort();
      },
      interrupt() {
        operation.cancel();
        setState(attempted === undefined ? { kind: 'interrupted' } : { kind: 'unconfirmed', expected: attempted });
      },
    };
    active.current = operation;
    setState({ kind: 'pending', checkingAgain: retry !== undefined });
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
        attempted = replacement.configuration;
        const result = await putBucketNotificationConfiguration(endpoint, bucket, attempted, signal);
        if (signal.aborted) return;
        if (result === NO_SUCH_BUCKET) {
          setState({ kind: 'missing' });
          return;
        }
        expected = attempted;
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
      if (failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') {
        expected = attempted;
      }
      setState(
        expected === undefined ? { kind: 'failed', stage, failure } : { kind: 'unconfirmed', expected, failure },
      );
    } finally {
      if (active.current === operation) active.current = undefined;
    }
  }

  const checkAgainDisabled = offline || (state.kind === 'unconfirmed' && state.failure?.kind === 'not-implemented');
  const unsupported = state.kind === 'failed' && state.failure.kind === 'not-implemented';
  return {
    state,
    checkAgainDisabled,
    pending: state.kind === 'pending',
    unsupported,
    readFailed: state.kind === 'failed' && state.stage === 'read',
    locked: state.kind === 'pending' || state.kind === 'unconfirmed' || unsupported,
    submit: (change: NotificationChange) => void run(change),
    checkAgain: () => {
      if (state.kind === 'unconfirmed' && !checkAgainDisabled) void run(undefined, state);
    },
    clear: () => setState({ kind: 'idle' }),
  };
}

export type NotificationChangeControl = ReturnType<typeof useNotificationChange>;
