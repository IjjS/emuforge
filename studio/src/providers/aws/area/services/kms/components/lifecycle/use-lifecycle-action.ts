import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';
import { LIFECYCLE_OPERATIONS, type LifecycleOperation } from '../../lifecycle-api';
import { KMS_KEYS } from '../../queries';

const stateChangingOperations = new Set<LifecycleOperation>([
  LIFECYCLE_OPERATIONS.disable,
  LIFECYCLE_OPERATIONS.enable,
  LIFECYCLE_OPERATIONS.schedule,
  LIFECYCLE_OPERATIONS.cancel,
]);

/**
 * Runs one lifecycle request of a key at a time. A result goes to the area's flash, outside the dialog that asked for
 * it, and the key's detail and the key list are read again, so the controls follow the state KMS returns.
 */
export function useLifecycleAction(connection: AreaConnection, keyId: string, refreshState: () => void) {
  const flash = usePageFlash();
  const signalForPage = usePageSignal();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const awaitingReadback = useRef(false);
  const [pending, setPending] = useState<LifecycleOperation>();
  const [confirmingState, setConfirmingState] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailable, setUnavailable] = useState<readonly LifecycleOperation[]>([]);
  const endpoint = connection.engineOrigin;
  const connected = connection.result === undefined || connection.result.kind === 'connected';

  const isUnavailable = (operation: LifecycleOperation) => unavailable.includes(operation);
  const disabled = (operation: LifecycleOperation) => endpoint === undefined || !connected || isUnavailable(operation);
  const confirmReadback = useCallback(() => {
    if (!awaitingReadback.current) return;
    awaitingReadback.current = false;
    setConfirmingState(false);
  }, []);

  /**
   * A confirmation closes on success or a 501. An ordinary refusal is announced in the original dialog if it
   * is still open, and through the page Flashbar otherwise.
   */
  const run = async (
    operation: LifecycleOperation,
    request: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
    dialog?: { close: (operation: LifecycleOperation) => void; isOpen: () => boolean },
  ) => {
    if (endpoint === undefined || disabled(operation) || inFlight.current || awaitingReadback.current) return;
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
        dialog?.close(operation);
        flash.show([item]);
      } else if (dialog?.isOpen()) {
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
    const changedState = stateChangingOperations.has(operation);
    if (changedState) {
      awaitingReadback.current = true;
      setConfirmingState(true);
    }
    flash.show([{ type: 'success', content: success }]);
    dialog?.close(operation);
    if (changedState) refreshState();
    else void queryClient.invalidateQueries({ queryKey: KMS_KEYS.detail(keyId) });
    void queryClient.invalidateQueries({ queryKey: KMS_KEYS.list });
  };

  return {
    pending,
    confirmingState,
    confirmReadback,
    failure,
    isUnavailable,
    disabled,
    run,
    clearFailure: () => setFailure(undefined),
  };
}

export type LifecycleAction = ReturnType<typeof useLifecycleAction>;
