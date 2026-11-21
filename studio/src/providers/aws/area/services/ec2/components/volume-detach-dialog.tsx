import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { AreaModal } from '../../../components/area-modal';
import { ValueText } from '../../../components/value-text';
import type { AttachmentTarget } from '../volume-api';
import type { VolumeDialogStatus } from './volume-attach-dialog';

interface VolumeDetachDialogProps extends VolumeDialogStatus {
  id: string;
  target: AttachmentTarget;
  onConfirm: () => void;
}

export function VolumeDetachDialog({
  id,
  target,
  pending,
  failure,
  unavailable,
  onConfirm,
  onDismiss,
}: VolumeDetachDialogProps) {
  return (
    <AreaModal
      visible
      header="Detach volume?"
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
            <Button variant="primary" loading={pending} disabled={pending || unavailable} onClick={onConfirm}>
              Detach volume
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={2}
          minColumnWidth={220}
          items={[
            { label: 'Volume ID', value: <ValueText kind="name" value={id} /> },
            { label: 'Instance ID', value: <ValueText kind="name" value={target.instanceId} /> },
            { label: 'Device', value: <ValueText kind="name" value={target.device} /> },
          ]}
        />
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
