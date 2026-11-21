import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ValueText } from '../../../components/value-text';
import type { VolumeDialogStatus } from './volume-attach-dialog';

interface VolumeDeleteDialogProps extends Omit<VolumeDialogStatus, 'unavailable'> {
  id: string;
  onConfirm: () => void;
}

export function VolumeDeleteDialog({ id, pending, failure, onConfirm, onDismiss }: VolumeDeleteDialogProps) {
  return (
    <ConfirmDialog
      visible
      header="Delete volume?"
      body={
        <>
          Deleting <ValueText kind="name" value={id} /> permanently removes its data. Type the volume ID to confirm.
          {failure !== undefined && (
            <Box variant="span" display="block" margin={{ top: 's' }}>
              <span role="alert">
                <StatusIndicator type="error">{failure.header}</StatusIndicator> {failure.content}
              </span>
            </Box>
          )}
        </>
      }
      word={id}
      action="Delete volume"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
