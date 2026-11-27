import '../../../components/name-text.css';

import Alert from '@cloudscape-design/components/alert';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { actionFailureItem } from '../../../components/failure-states';
import { holdsHiddenWhiteSpace } from '../../../components/name-identity';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { LINE_BREAK, normalizeLineBreaks, streamNameLabel } from '../format';
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
  const confirmationName = normalizeLineBreaks(name);
  const hasLineBreaks = LINE_BREAK.test(name);
  const identity = streamNameLabel(name);
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
          <span aria-hidden="true">
            Delete log stream{' '}
            <span style={hasLineBreaks ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : undefined}>
              <ValueText kind="name" value={confirmationName} />
              {holdsHiddenWhiteSpace(name) && (
                <>
                  {' '}
                  <ValueText kind="name" value={`(${identity})`} />
                </>
              )}
            </span>
            ?
          </span>
          <span className="aws-area-name-identity">{`Delete log stream ${identity}?`}</span>
        </>
      }
      body="Its log events are removed from your local emulator. This cannot be undone."
      label="To confirm, type the log stream's name."
      name={confirmationName}
      action="Delete"
      pending={pending}
      multiline
      nameCopy={
        hasLineBreaks ? (
          <CopyToClipboard
            variant="button"
            textToCopy={name}
            copyButtonText="Copy log stream name"
            copySuccessText="Log stream name copied"
            copyErrorText="Log stream name could not be copied"
            popoverRenderWithPortal={false}
          />
        ) : undefined
      }
      unavailable={unavailable ? feedback : undefined}
      feedback={unavailable ? undefined : feedback}
      onConfirm={() => void handleConfirm()}
      onDismiss={onDismiss}
    />
  );
}
