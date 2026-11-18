import { useCallback, useEffect, useRef } from 'react';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';

// What S2's actions share (issue 481, design tasks 2 to 4): the signal that ends an action's request when the page is
// left, and the failure an action's rejection carries.

/**
 * A signal for an action of the page: aborted once the page is left, so a long read ("Up to 20 seconds") or a send in
 * flight ends with it, and its answer changes nothing shown.
 */
export function usePageSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  return useCallback(() => {
    if (controller.current === null) {
      controller.current = new AbortController();
    }
    return controller.current.signal;
  }, []);
}

/** The failure of a rejected action of `operation`. */
export function actionFailureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}
