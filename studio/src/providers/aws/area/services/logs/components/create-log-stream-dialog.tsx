import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { CREATE_LOG_STREAM, createLogStream } from '../stream-change-api';

const NAME_RULE = 'Enter 1 to 512 characters, without ":" or "*".';

interface CreateLogStreamDialogProps {
  endpoint: string;
  group: string;
  unavailable: boolean;
  onUnavailable: () => void;
  onCreated: (name: string) => void;
  onDismiss: () => void;
}

export function CreateLogStreamDialog({
  endpoint,
  group,
  unavailable,
  onUnavailable,
  onCreated,
  onDismiss,
}: CreateLogStreamDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const shownFailure: RequestFailure | undefined = unavailable
    ? { kind: 'not-implemented', operation: CREATE_LOG_STREAM }
    : failure;
  const item = shownFailure && actionFailureItem(shownFailure, CREATE_LOG_STREAM, endpoint);

  const handleCreate = async () => {
    if (inFlight.current || unavailable) return;
    setFailure(undefined);
    if (name === '' || [...name].length > 512 || /[:*]/.test(name)) {
      setNameError(name === '' ? 'Enter a log stream name.' : NAME_RULE);
      return;
    }

    setNameError(undefined);
    inFlight.current = true;
    setPending(true);
    const signal = pageSignal();
    try {
      await createLogStream(endpoint, group, name, signal);
    } catch (error) {
      if (!signal.aborted) {
        const refusal = failureOf(error, CREATE_LOG_STREAM);
        setFailure(refusal);
        if (refusal.kind === 'not-implemented') onUnavailable();
        inFlight.current = false;
        setPending(false);
      }
      return;
    }
    if (!signal.aborted) onCreated(name);
  };

  const handleDismiss = () => {
    if (!pending) onDismiss();
  };

  return (
    <AreaModal
      visible
      header="Create log stream"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={pending || unavailable}
              onClick={() => void handleCreate()}
            >
              Create log stream
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {item && (
          <div role="alert">
            <Alert type={item.type} header={item.header}>
              {(shownFailure?.kind === 'engine-did-not-answer' || shownFailure?.kind === 'emulator-did-not-answer') &&
                `${CREATE_LOG_STREAM} failed. `}
              {item.content}
            </Alert>
          </div>
        )}
        <FormField label="Log stream name" constraintText={NAME_RULE} {...(nameError && { errorText: nameError })}>
          <Textarea
            rows={2}
            resize="vertical"
            value={name}
            readOnly={pending}
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => setName(detail.value)}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
