import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { V2_STAGE_NAME_RULE, v2StageNameError } from '../v2-stage-form';
import { useCreateV2Stage } from '../v2-stage-queries';
import { RestChangeFailure } from './delete-resource-dialog';

export function CreateV2StageDialog({
  apiId,
  endpoint,
  onCreated,
  onClose,
}: {
  apiId: string;
  endpoint: string | undefined;
  onCreated: (stageName: string) => void;
  onClose: () => void;
}) {
  const [stageName, setStageName] = useState('');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<InputProps.Ref>(null);
  const create = useCreateV2Stage(apiId, endpoint, onCreated);
  const nameError = v2StageNameError(stageName);

  function handleClose() {
    if (!create.isPending) onClose();
  }

  function handleCreate() {
    if (!create.available || create.isPending) return;
    setSubmitted(true);
    if (nameError) {
      nameRef.current?.focus();
      return;
    }
    create.submit({ stageName, autoDeploy });
  }

  return (
    <AreaModal
      visible
      header="Create stage"
      closeAriaLabel="Close dialog"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={create.isPending} onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!create.available} loading={create.isPending} onClick={handleCreate}>
              Create stage
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Stage name" constraintText={V2_STAGE_NAME_RULE} errorText={submitted ? nameError : undefined}>
          <Input
            ref={nameRef}
            value={stageName}
            readOnly={create.isPending}
            onChange={({ detail }) => setStageName(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') handleCreate();
            }}
          />
        </FormField>
        <FormField label="Auto-deploy">
          <RadioGroup
            ariaLabel="Auto-deploy"
            value={autoDeploy ? 'on' : 'off'}
            items={[
              { value: 'on', label: 'On', description: 'Changes are served at once.', disabled: create.isPending },
              {
                value: 'off',
                label: 'Off',
                description: 'Changes are served after you deploy to the stage.',
                disabled: create.isPending,
              },
            ]}
            onChange={({ detail }) => setAutoDeploy(detail.value === 'on')}
          />
        </FormField>
        {create.failure && <RestChangeFailure failure={create.failure} endpoint={endpoint} />}
      </SpaceBetween>
    </AreaModal>
  );
}
