import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { V2_API_NAME_LIMIT } from '../format';
import type { V2ApiFields } from '../v2-route-change-api';
import { useUpdateV2Api } from '../v2-route-change-queries';
import { RestChangeFailure } from './delete-resource-dialog';

const NAME_RULE = `1 to ${V2_API_NAME_LIMIT} characters.`;

interface EditV2ApiDialogProps {
  apiId: string;
  current: V2ApiFields;
  endpoint: string | undefined;
  onSaved: (name: string) => void;
  onDismiss: () => void;
}

export function EditV2ApiDialog({ apiId, current, endpoint, onSaved, onDismiss }: EditV2ApiDialogProps) {
  const [previous] = useState(current);
  const [name, setName] = useState(previous.name);
  const [description, setDescription] = useState(previous.description);
  const [submitted, setSubmitted] = useState(false);
  const change = useUpdateV2Api(endpoint, apiId, onSaved);
  const changed = name !== previous.name || description !== previous.description;
  const length = Array.from(name).length;
  const validName = length >= 1 && length <= V2_API_NAME_LIMIT;
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
