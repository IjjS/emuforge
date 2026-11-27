import Alert from '@cloudscape-design/components/alert';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmNameDialog } from '../../../components/confirm-name-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { BUS_CHANGE_OPERATIONS, deleteEventBus } from '../bus-change-api';

interface DeleteEventBusDialogProps {
  endpoint: string;
  name: string;
  onDeleted: () => void;
  onUnavailable: () => void;
  onDismiss: () => void;
}

export function DeleteEventBusDialog({
  endpoint,
  name,
  onDeleted,
  onUnavailable,
  onDismiss,
}: DeleteEventBusDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const operation = BUS_CHANGE_OPERATIONS.delete;
  const unavailable = failure?.kind === 'not-implemented';
  const item = failure && actionFailureItem(failure, operation, endpoint);
  const feedback = item && (
    <div role="alert">
      <Alert type={item.type} header={item.header}>
        {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
          `${operation} failed. `}
        {item.content}
      </Alert>
    </div>
  );

  async function handleConfirm() {
    if (inFlight.current || unavailable) return;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      await deleteEventBus(endpoint, name, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      setFailure(refusal);
      if (refusal.kind === 'not-implemented') onUnavailable();
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onDeleted();
  }

  return (
    <ConfirmNameDialog
      visible
      header={
        <>
          Delete event bus <ValueText kind="name" value={name} />?
        </>
      }
      body="The event bus is removed from your local emulator. This cannot be undone."
      label="To confirm, type the event bus's name."
      name={name}
      action="Delete"
      pending={pending}
      unavailable={unavailable ? feedback : undefined}
      feedback={unavailable ? undefined : feedback}
      onConfirm={() => void handleConfirm()}
      onDismiss={() => {
        if (!inFlight.current) onDismiss();
      }}
    />
  );
}
