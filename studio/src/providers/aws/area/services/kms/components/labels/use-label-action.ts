import { useLayoutEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';

export function useLabelAction(
  connection: AreaConnection,
  writesEnabled: boolean,
  keyMissing: boolean,
  onSaved: () => void,
) {
  const flash = usePageFlash();
  const signalForPage = usePageSignal();
  const inFlight = useRef<{ dialogClosed: boolean }>(undefined);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailable, setUnavailable] = useState<readonly string[]>([]);
  const endpoint = connection.engineOrigin;
  const connected = connection.result === undefined || connection.result.kind === 'connected';

  useLayoutEffect(() => {
    // Even if a later read finds the key, the dialog for this request has already gone.
    if (keyMissing && inFlight.current !== undefined) inFlight.current.dialogClosed = true;
  }, [keyMissing]);

  const disabled = (operation: string) =>
    keyMissing || !writesEnabled || endpoint === undefined || !connected || pending || unavailable.includes(operation);

  const run = async (
    operation: string,
    request: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
    close: () => void,
    keepOpenOnFailure = true,
  ) => {
    if (endpoint === undefined || disabled(operation) || inFlight.current !== undefined) return;
    const signal = signalForPage();
    const attempt = { dialogClosed: false };
    inFlight.current = attempt;
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
      } else if (keepOpenOnFailure && !attempt.dialogClosed) {
        setFailure(item);
        flash.show([{ ...item, announcedInDialog: true }]);
      } else {
        close();
        flash.show([item]);
      }
      return;
    } finally {
      inFlight.current = undefined;
      if (!signal.aborted) setPending(false);
    }
    if (signal.aborted) return;
    flash.show([{ type: 'success', content: success }]);
    close();
    onSaved();
  };

  return { pending, failure, unavailable, disabled, run, clearFailure: () => setFailure(undefined) };
}
