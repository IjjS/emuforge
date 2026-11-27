import { StateValue } from '@aws-sdk/client-cloudwatch';
import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState } from 'react';

import { reportedServiceCode, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { alarmStateText } from '../format';
import { SET_ALARM_STATE, setAlarmState } from '../try-api';
import { AlarmName } from './alarm-name';

const REASON_RULE = '1 to 1023 characters.';
const STATES = Object.values(StateValue);

interface SetStateDialogProps {
  endpoint: string;
  name: string;
  currentState: StateValue | undefined;
  unavailable: boolean;
  onUnavailable: () => void;
  onSet: (state: StateValue) => void;
  onDismiss: () => void;
}

export function SetStateDialog({
  endpoint,
  name,
  currentState,
  unavailable,
  onUnavailable,
  onSet,
  onDismiss,
}: SetStateDialogProps) {
  const options = STATES.filter((value) => value !== currentState).map((value) => ({
    value,
    label: alarmStateText(value),
    description: `Sets the alarm to ${alarmStateText(value)}.`,
  }));
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const selectRef = useRef<SelectProps.Ref>(null);
  const reasonRef = useRef<TextareaProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const [state, setState] = useState<StateValue>();
  const [reason, setReason] = useState('Set by hand in EmuForge Studio');
  const [stateError, setStateError] = useState(false);
  const [reasonError, setReasonError] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const shownFailure = unavailable ? ({ kind: 'not-implemented', operation: SET_ALARM_STATE } as const) : failure;
  const disabled = shownFailure?.kind === 'not-implemented';
  const feedback = shownFailure && actionFailureItem(shownFailure, SET_ALARM_STATE, endpoint);
  const accessDeniedCode = shownFailure?.kind === 'access-denied' ? reportedServiceCode(shownFailure) : undefined;

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  const handleDismiss = () => {
    if (!inFlight.current) onDismiss();
  };

  const handleConfirm = async () => {
    if (disabled || inFlight.current) return;
    const length = Array.from(reason).length;
    const invalidReason = length < 1 || length > 1023;
    setStateError(state === undefined);
    setReasonError(invalidReason);
    if (state === undefined) {
      selectRef.current?.focus();
      return;
    }
    if (invalidReason) {
      reasonRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    const signal = pageSignal();
    try {
      await setAlarmState(endpoint, name, state, reason, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, SET_ALARM_STATE);
      setFailure(refusal);
      if (refusal.kind === 'not-implemented') onUnavailable();
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onSet(state);
  };

  return (
    <AreaModal
      visible
      header={
        <>
          Set state of <AlarmName name={name} />
        </>
      }
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={disabled} loading={pending} onClick={() => void handleConfirm()}>
              Set state
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          When the state changes and the alarm's actions are on, the actions of the new state run. The history records
          the change and each action that ran.
        </Box>
        {feedback && (
          <div role="alert">
            <Alert ref={failureRef} type={feedback.type} header={feedback.header}>
              {(shownFailure?.kind === 'emulator-did-not-answer' || shownFailure?.kind === 'engine-did-not-answer') &&
                `${SET_ALARM_STATE} failed. `}
              {feedback.content}
              {accessDeniedCode && ` (${accessDeniedCode})`}
            </Alert>
          </div>
        )}
        <FormField label="New state" errorText={stateError ? 'Choose a state.' : undefined}>
          <Select
            ref={selectRef}
            selectedOption={options.find(({ value }) => value === state) ?? null}
            options={options}
            placeholder="Choose a state"
            disabled={pending}
            onChange={({ detail }) => {
              setState(options.find(({ value }) => value === detail.selectedOption.value)?.value);
              setStateError(false);
            }}
          />
        </FormField>
        <FormField label="Reason" constraintText={REASON_RULE} errorText={reasonError ? REASON_RULE : undefined}>
          <Textarea
            ref={reasonRef}
            value={reason}
            disabled={pending}
            onChange={({ detail }) => {
              setReason(detail.value);
              setReasonError(false);
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
