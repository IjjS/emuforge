import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';
import type { LifecycleOperation } from '../../lifecycle-api';
import { KMS_KEYS } from '../../queries';

/**
 * Runs one lifecycle request of a key at a time. A result goes to the area's flash, outside the dialog that asked for
 * it, and the key's detail and the key list are read again, so the controls follow the state KMS returns.
 */
export function useLifecycleAction(connection: AreaConnection, keyId: string) {
  const flash = usePageFlash();
  const signalForPage = usePageSignal();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState<LifecycleOperation>();
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailable, setUnavailable] = useState<readonly LifecycleOperation[]>([]);
  const endpoint = connection.engineOrigin;
  const connected = connection.result === undefined || connection.result.kind === 'connected';

  const isUnavailable = (operation: LifecycleOperation) => unavailable.includes(operation);
  const disabled = (operation: LifecycleOperation) => endpoint === undefined || !connected || isUnavailable(operation);

  /**
   * Sends `request`. `close` ends the dialog that asked for it, if any: on success, and on a 501, whose action then
   * stays on the page as unavailable. Any other failure stays in the open dialog, or in the flash without one.
   */
  const run = async (
    operation: LifecycleOperation,
    request: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
    close?: (unavailableOperation?: LifecycleOperation) => void,
  ) => {
    if (endpoint === undefined || disabled(operation) || inFlight.current) return;
    const signal = signalForPage();
    inFlight.current = true;
    setPending(operation);
    setFailure(undefined);
    try {
      await request(endpoint, signal);
    } catch (error) {
      if (signal.aborted) return;
      const reason = failureOf(error, operation);
      const item = actionFailureItem(reason, operation, endpoint);
      if (reason.kind === 'not-implemented') {
        setUnavailable((operations) => [...operations, operation]);
        close?.(operation);
        flash.show([item]);
      } else if (close !== undefined) {
        setFailure(item);
        flash.show([{ ...item, announcedInDialog: true }]);
      } else {
        flash.show([item]);
      }
      return;
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(undefined);
    }
    if (signal.aborted) return;
    flash.show([{ type: 'success', content: success }]);
    close?.();
    void queryClient.invalidateQueries({ queryKey: KMS_KEYS.detail(keyId) });
    void queryClient.invalidateQueries({ queryKey: KMS_KEYS.list });
  };

  return { pending, failure, isUnavailable, disabled, run, clearFailure: () => setFailure(undefined) };
}

export type LifecycleAction = ReturnType<typeof useLifecycleAction>;
