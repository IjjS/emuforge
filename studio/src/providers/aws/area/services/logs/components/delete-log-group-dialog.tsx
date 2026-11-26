import Alert from '@cloudscape-design/components/alert';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { DELETE_LOG_GROUP, deleteLogGroup } from '../group-delete-api';
import { ConfirmNameDialog } from './confirm-name-dialog';

interface DeleteLogGroupDialogProps {
  endpoint: string;
  name: string;
  protectedFromDeletion: boolean;
  unavailable: boolean;
  onUnavailable: () => void;
  onDeleted: (name: string) => void;
  onDismiss: () => void;
}

/** Mount for each opening, with the group as it was read when the dialog opened. */
export function DeleteLogGroupDialog({
  endpoint,
  name,
  protectedFromDeletion,
  unavailable,
  onUnavailable,
  onDeleted,
  onDismiss,
}: DeleteLogGroupDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();

  const shownFailure: RequestFailure | undefined = unavailable
    ? { kind: 'not-implemented', operation: DELETE_LOG_GROUP }
    : failure;
  const item = shownFailure && actionFailureItem(shownFailure, DELETE_LOG_GROUP, endpoint);
  const feedback = item && (
    <div role="alert">
      <Alert type={item.type} header={item.header}>
        {(shownFailure?.kind === 'engine-did-not-answer' || shownFailure?.kind === 'emulator-did-not-answer') &&
          `${DELETE_LOG_GROUP} failed. `}
        {item.content}
      </Alert>
    </div>
  );
  const protection = protectedFromDeletion ? (
    <Alert type="warning">Deletion protection is on. Turn it off before deleting this log group.</Alert>
  ) : undefined;

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    const signal = pageSignal();
    try {
      await deleteLogGroup(endpoint, name, signal);
    } catch (error) {
      if (!signal.aborted) {
        const refusal = failureOf(error, DELETE_LOG_GROUP);
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
          Delete log group <ValueText kind="name" value={name} />?
        </>
      }
      body="Its log streams and log events are removed from your local emulator. This cannot be undone."
      label="To confirm, type the log group's name."
      name={name}
      action="Delete"
      pending={pending}
      unavailable={protection ?? (unavailable ? feedback : undefined)}
      feedback={unavailable && protection === undefined ? undefined : feedback}
      onConfirm={() => void handleConfirm()}
      onDismiss={onDismiss}
    />
  );
}
