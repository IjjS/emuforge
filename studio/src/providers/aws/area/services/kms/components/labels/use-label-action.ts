import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';

export function useLabelAction(connection: AreaConnection, onSaved: () => void) {
  const flash = usePageFlash();
  const signalForPage = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailable, setUnavailable] = useState<readonly string[]>([]);
  const endpoint = connection.engineOrigin;
  const connected = connection.result === undefined || connection.result.kind === 'connected';

  const disabled = (operation: string) =>
    endpoint === undefined || !connected || pending || unavailable.includes(operation);

  const run = async (
    operation: string,
    request: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
    close: () => void,
    keepOpenOnFailure = true,
  ) => {
    if (endpoint === undefined || disabled(operation) || inFlight.current) return;
    const signal = signalForPage();
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      await request(endpoint, signal);
    } catch (error) {
      if (signal.aborted) return;
      const reason = failureOf(error, operation);
      const item = actionFailureItem(reason, operation, endpoint);
      if (reason.kind === 'not-implemented') {
        setUnavailable((operations) => [...operations, operation]);
        close();
        flash.show([item]);
      } else if (keepOpenOnFailure) {
        setFailure(item);
        flash.show([{ ...item, announcedInDialog: true }]);
      } else {
        close();
        flash.show([item]);
      }
      return;
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(false);
    }
    if (signal.aborted) return;
    flash.show([{ type: 'success', content: success }]);
    close();
    onSaved();
  };

  return { pending, failure, unavailable, disabled, run, clearFailure: () => setFailure(undefined) };
}
