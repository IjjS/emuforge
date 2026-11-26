import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { GROUP_CREATE_OPERATIONS, putRetentionPolicy } from '../group-create-api';
import { deleteRetentionPolicy, GROUP_SETTINGS_OPERATIONS } from '../group-settings-api';
import { RetentionSelect } from './retention-select';

interface EditRetentionDialogProps {
  endpoint: string;
  name: string;
  retention: number | undefined;
  unavailable: ReadonlySet<string>;
  onUnavailable: (operation: string) => void;
  onSaved: (retention: number | undefined) => void;
  onDismiss: () => void;
}

export function EditRetentionDialog({
  endpoint,
  name,
  retention,
  unavailable,
  onUnavailable,
  onSaved,
  onDismiss,
}: EditRetentionDialogProps) {
  const pageSignal = usePageSignal();
  const busy = useRef(false);
  const [choice, setChoice] = useState(retention);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const operation =
    choice === undefined ? GROUP_SETTINGS_OPERATIONS.deleteRetentionPolicy : GROUP_CREATE_OPERATIONS.putRetentionPolicy;
  const unsupported = unavailable.has(operation);
  const shownFailure: RequestFailure | undefined = unsupported ? { kind: 'not-implemented', operation } : failure;
  const feedback = shownFailure && actionFailureItem(shownFailure, operation, endpoint);

  async function save() {
    if (busy.current || unsupported) return;
    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      if (choice === undefined) await deleteRetentionPolicy(endpoint, name, signal);
      else await putRetentionPolicy(endpoint, name, choice, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      if (refusal.kind === 'not-implemented') onUnavailable(operation);
      setFailure(refusal);
      busy.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onSaved(choice);
  }

  const dismiss = () => {
    if (!busy.current) onDismiss();
  };

  return (
    <AreaModal
      visible
      header="Edit retention"
      closeAriaLabel="Close dialog"
      onDismiss={dismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={dismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={pending || unsupported} onClick={() => void save()}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {feedback && (
          <div role="alert">
            <Alert type={feedback.type} header={feedback.header}>
              {(shownFailure?.kind === 'engine-did-not-answer' || shownFailure?.kind === 'emulator-did-not-answer') &&
                `${operation} failed. `}
              {feedback.content}
            </Alert>
          </div>
        )}
        <FormField label="Retention">
          <RetentionSelect
            value={choice}
            disabled={pending}
            onChange={(value) => {
              setChoice(value);
              setFailure(undefined);
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
