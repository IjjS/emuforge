import Alert from '@cloudscape-design/components/alert';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { DELETE_LOG_STREAM, deleteLogStream } from '../stream-change-api';
import { ConfirmNameDialog } from './confirm-name-dialog';

interface DeleteLogStreamDialogProps {
  endpoint: string;
  group: string;
  name: string;
  unavailable: boolean;
  onUnavailable: () => void;
  onDeleted: (name: string) => void;
  onDismiss: () => void;
}

export function DeleteLogStreamDialog({
  endpoint,
  group,
  name,
  unavailable,
  onUnavailable,
  onDeleted,
  onDismiss,
}: DeleteLogStreamDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const shownFailure: RequestFailure | undefined = unavailable
    ? { kind: 'not-implemented', operation: DELETE_LOG_STREAM }
    : failure;
  const item = shownFailure && actionFailureItem(shownFailure, DELETE_LOG_STREAM, endpoint);
  const feedback = item && (
    <div role="alert">
      <Alert type={item.type} header={item.header}>
        {(shownFailure?.kind === 'engine-did-not-answer' || shownFailure?.kind === 'emulator-did-not-answer') &&
          `${DELETE_LOG_STREAM} failed. `}
        {item.content}
      </Alert>
    </div>
  );

  const handleConfirm = async () => {
    if (inFlight.current || unavailable) return;
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    const signal = pageSignal();
    try {
      await deleteLogStream(endpoint, group, name, signal);
    } catch (error) {
      if (!signal.aborted) {
        const refusal = failureOf(error, DELETE_LOG_STREAM);
        setFailure(refusal);
        if (refusal.kind === 'not-implemented') onUnavailable();
        inFlight.current = false;
        setPending(false);
      }
      return;
    }
    if (!signal.aborted) onDeleted(name);
  };

  return (
    <ConfirmNameDialog
      visible
      header={
        <>
          Delete log stream <ValueText kind="name" value={name} />?
        </>
      }
      body="Its log events are removed from your local emulator. This cannot be undone."
      label="To confirm, type the log stream's name."
      name={name}
      action="Delete"
      pending={pending}
      unavailable={unavailable ? feedback : undefined}
      feedback={unavailable ? undefined : feedback}
      onConfirm={() => void handleConfirm()}
      onDismiss={onDismiss}
    />
  );
}
