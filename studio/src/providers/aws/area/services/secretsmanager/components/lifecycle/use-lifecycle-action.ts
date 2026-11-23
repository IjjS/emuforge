import { useLayoutEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { failureOf } from '../../../../components/use-token-listing';

export function useLifecycleAction(connection: AreaConnection) {
  const { engineOrigin } = connection;
  const connected = connection.result?.kind === 'connected';
  const request = useRef<AbortController | null>(null);
  const [pendingRequest, setPending] = useState<{ operation: string; controller: AbortController }>();
  const [failure, setFailure] = useState<RequestFailure>();
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [connected, engineOrigin],
  );

  const disabled = (operation: string) => !connected || engineOrigin === undefined || unavailable.has(operation);

  async function run<Result>(
    operation: string,
    send: (endpoint: string, signal: AbortSignal) => Promise<Result>,
    onSuccess: (result: Result, endpoint: string) => void,
  ) {
    if (engineOrigin === undefined || disabled(operation) || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setPending({ operation, controller });
    setFailure(undefined);
    try {
      const result = await send(engineOrigin, controller.signal);
      if (!controller.signal.aborted) onSuccess(result, engineOrigin);
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = failureOf(error, operation);
        setFailure(failure);
        if (failure.kind === 'not-implemented') {
          setUnavailable((current) => new Set([...current, operation]));
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(undefined);
      }
    }
  }

  return {
    pending: connected && !pendingRequest?.controller.signal.aborted ? pendingRequest?.operation : undefined,
    failure,
    unavailable,
    disabled,
    run,
    clearFailure: () => setFailure(undefined),
  };
}

export type LifecycleAction = ReturnType<typeof useLifecycleAction>;
