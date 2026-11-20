import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import type { FlashItem } from '../../../components/page-flash';
import type { Instance } from '../api';
import type { AttachmentTarget } from '../volume-api';
import { volumeInstanceChoices } from '../volume-queries';

export interface VolumeDialogStatus {
  pending: boolean;
  failure: FlashItem | undefined;
  unavailable: boolean;
  onDismiss: () => void;
}

interface VolumeAttachDialogProps extends VolumeDialogStatus {
  connection: AreaConnection;
  endpoint: string;
  zone: string | undefined;
  onConfirm: (target: AttachmentTarget) => void;
}

export function VolumeAttachDialog({
  connection,
  endpoint,
  zone,
  pending,
  failure,
  unavailable,
  onConfirm,
  onDismiss,
}: VolumeAttachDialogProps) {
  const [instance, setInstance] = useState<Instance>();
  const [device, setDevice] = useState('');
  const canSubmit = !pending && !unavailable && instance !== undefined && device.trim() !== '';

  return (
    <AreaModal
      visible
      header="Attach volume"
      closeAriaLabel="Close dialog"
      onDismiss={() => {
        if (!pending) onDismiss();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!canSubmit}
              onClick={() => {
                if (canSubmit) onConfirm({ instanceId: instance.id, device: device.trim() });
              }}
            >
              Attach volume
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
        <FormField
          label="Instance"
          description={
            zone === undefined
              ? 'Choose an instance in the volume’s Availability Zone.'
              : `Choose an instance in ${zone}, the volume’s Availability Zone.`
          }
        >
          <ChoiceSelect
            source={volumeInstanceChoices(endpoint)}
            connection={connection}
            things="instances"
            ariaLabel="Instance"
            placeholder="Choose an instance"
            triggerVariant="option"
            value={instance}
            onChange={setInstance}
          />
        </FormField>
        <FormField label="Device name" constraintText="For example, /dev/sdf.">
          <Input
            value={device}
            disabled={pending}
            onChange={({ detail }) => {
              setDevice(detail.value);
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
