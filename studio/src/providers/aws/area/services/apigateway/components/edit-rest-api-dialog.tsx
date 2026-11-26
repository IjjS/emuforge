import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { REST_API_NAME_LIMIT } from '../format';
import type { RestApiFields } from '../rest-change-api';
import { useUpdateRestApi } from '../rest-change-queries';
import { RestChangeFailure } from './delete-resource-dialog';

const NAME_RULE = `1 to ${REST_API_NAME_LIMIT} characters.`;

interface EditRestApiDialogProps {
  apiId: string;
  current: RestApiFields;
  endpoint: string | undefined;
  onSaved: (name: string) => void;
  onDismiss: () => void;
}

export function EditRestApiDialog({ apiId, current, endpoint, onSaved, onDismiss }: EditRestApiDialogProps) {
  const [previous] = useState(current);
  const [name, setName] = useState(previous.name);
  const [description, setDescription] = useState(previous.description);
  const [submitted, setSubmitted] = useState(false);
  const change = useUpdateRestApi(endpoint, apiId, previous, onSaved);
  const changed = name !== previous.name || description !== previous.description;
  const length = Array.from(name).length;
  const validName = length >= 1 && length <= REST_API_NAME_LIMIT;
  const canSave = change.available && !change.isPending && changed;

  function handleSave() {
    if (!canSave) return;
    setSubmitted(true);
    if (validName) change.submit({ name, description });
  }

  function handleDismiss() {
    if (!change.isPending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header="Edit API"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={change.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} loading={change.isPending} onClick={handleSave}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Name" constraintText={NAME_RULE} errorText={submitted && !validName ? NAME_RULE : undefined}>
          <Input value={name} onChange={({ detail }) => setName(detail.value)} readOnly={change.isPending} />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={({ detail }) => setDescription(detail.value)}
            readOnly={change.isPending}
          />
        </FormField>
        {change.failure && <RestChangeFailure failure={change.failure} endpoint={endpoint} />}
      </SpaceBetween>
    </AreaModal>
  );
}
