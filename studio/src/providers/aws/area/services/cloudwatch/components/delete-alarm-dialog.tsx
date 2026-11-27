import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { DELETE_ALARMS, deleteAlarm } from '../delete-api';
import { AlarmName } from './alarm-name';

interface DeleteAlarmDialogProps {
  endpoint: string;
  name: string;
  unavailable: boolean;
  onUnavailable: () => void;
  onDeleted: (name: string) => void;
  onDismiss: () => void;
}

export function DeleteAlarmDialog({
  endpoint,
  name,
  unavailable,
  onUnavailable,
  onDeleted,
  onDismiss,
}: DeleteAlarmDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const submitRef = useRef<ButtonProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<RequestFailure>();
  const shownFailure = unavailable ? ({ kind: 'not-implemented', operation: DELETE_ALARMS } as const) : failure;
  const feedback = shownFailure && actionFailureItem(shownFailure, DELETE_ALARMS, endpoint);
  const disabled = typed !== 'delete' || unavailable || shownFailure?.kind === 'not-implemented';

  useEffect(() => {
    // Cloudscape moves focus to the heading when the dismiss button is hidden.
    if (pending) submitRef.current?.focus();
    if (failure) failureRef.current?.focus();
  }, [failure, pending]);

  const handleDismiss = () => {
    if (!inFlight.current) onDismiss();
  };

  const handleConfirm = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    const signal = pageSignal();
    try {
      await deleteAlarm(endpoint, name, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, DELETE_ALARMS);
      setFailure(refusal);
      if (refusal.kind === 'not-implemented') onUnavailable();
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onDeleted(name);
  };

  return (
    <AreaModal
      visible
      header={
        <>
          Delete alarm <AlarmName name={name} />?
        </>
      }
      closeAriaLabel="Close dialog"
      hideDismissButton={pending}
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              ref={submitRef}
              variant="primary"
              disabled={disabled}
              loading={pending}
              loadingText="Deleting alarm"
              onClick={() => void handleConfirm()}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">The alarm is removed from your local emulator. This cannot be undone.</Box>
        {feedback && (
          <div role="alert">
            <Alert ref={failureRef} type={feedback.type} header={feedback.header}>
              {(shownFailure?.kind === 'emulator-did-not-answer' || shownFailure?.kind === 'engine-did-not-answer') &&
                `${DELETE_ALARMS} failed. `}
              {feedback.content}
            </Alert>
          </div>
        )}
        <FormField label="To confirm, type delete.">
          <Input
            value={typed}
            disabled={pending}
            onChange={({ detail }) => setTyped(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') void handleConfirm();
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
