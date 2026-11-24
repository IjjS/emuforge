import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';

export function useAccessAction(connection: AreaConnection, writesEnabled: boolean) {
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const busy = useRef(false);
  const [pending, setPending] = useState<string>();
  const [failure, setFailure] = useState<RequestFailure>();
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  const endpoint = connection.engineOrigin;
  const disabled = (operation: string) =>
    !writesEnabled ||
    pending !== undefined ||
    endpoint === undefined ||
    connection.result?.kind !== 'connected' ||
    unavailable.has(operation);

  async function run(
    operation: string,
    send: (endpoint: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
    onSaved: () => void,
    onFailed?: () => void,
  ) {
    if (disabled(operation) || busy.current || endpoint === undefined) return;
    const signal = pageSignal();
    busy.current = true;
    setPending(operation);
    setFailure(undefined);
    try {
      await send(endpoint, signal);
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, operation);
      setFailure(failure);
      if (failure.kind === 'not-implemented') {
        setUnavailable((current) => new Set([...current, operation]));
      }
      flash.show([
        {
          ...actionFailureItem(failure, operation, endpoint),
          ...(onFailed === undefined && { announcedInDialog: true }),
        },
      ]);
      onFailed?.();
      return;
    } finally {
      busy.current = false;
      if (!signal.aborted) setPending(undefined);
    }
    if (signal.aborted) return;
    flash.show([{ type: 'success', content: success }]);
    onSaved();
  }

  return { disabled, failure, pending, run, unavailable, clearFailure: () => setFailure(undefined) };
}
