import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { BUS_DESCRIPTION_RULE, busDescriptionError } from '../bus-form';
import { BUS_SETTINGS_OPERATIONS, updateBusDescription } from '../bus-settings-api';

interface EditDescriptionDialogProps {
  endpoint: string;
  name: string;
  description: string;
  onUnavailable: () => void;
  onSaved: () => void;
  onDismiss: () => void;
}

export function EditDescriptionDialog({
  endpoint,
  name,
  description,
  onUnavailable,
  onSaved,
  onDismiss,
}: EditDescriptionDialogProps) {
  const pageSignal = usePageSignal();
  const busy = useRef(false);
  const field = useRef<TextareaProps.Ref>(null);
  const [draft, setDraft] = useState(description);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const operation = BUS_SETTINGS_OPERATIONS.update;
  const unavailable = failure?.kind === 'not-implemented';
  const feedback = failure && actionFailureItem(failure, operation, endpoint);

  async function handleSave() {
    if (busy.current || unavailable) return;
    setTried(true);
    if (busDescriptionError(draft) !== undefined) {
      field.current?.focus();
      return;
    }
    if (draft === description) {
      onDismiss();
      return;
    }

    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      await updateBusDescription(endpoint, name, draft, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      setFailure(refusal);
      if (refusal.kind === 'not-implemented') onUnavailable();
      busy.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onSaved();
  }

  function handleDismiss() {
    if (!busy.current) onDismiss();
  }

  return (
    <AreaModal
      visible
      header="Edit description"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={unavailable} onClick={() => void handleSave()}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField
          label="Description"
          description={BUS_DESCRIPTION_RULE}
          errorText={tried ? busDescriptionError(draft) : undefined}
        >
          <Textarea ref={field} value={draft} readOnly={pending} onChange={({ detail }) => setDraft(detail.value)} />
        </FormField>
        {feedback && (
          <div role="alert">
            <Alert type={feedback.type} header={feedback.header}>
              {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
                `${operation} failed. `}
              {feedback.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
