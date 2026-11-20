import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';

// The dialog of a parting that can be done again (S9's "Disassociate", S12's "Detach"), on the area's `AreaModal`,
// confirmed with its button alone, no word typed. "Cancel", Esc and the close control close it and send nothing;
// while the request is in flight neither button acts.

export interface PartDialogProps {
  visible: boolean;
  header: ReactNode;
  body: ReactNode;
  /** The action's button ("Disassociate", "Detach"). */
  action: string;
  /** The action's request is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function PartDialog({ visible, header, body, action, pending, onConfirm, onDismiss }: PartDialogProps) {
  if (!visible) {
    return null;
  }
  const handleConfirm = () => {
    if (!pending) {
      onConfirm();
    }
  };
  const handleDismiss = () => {
    if (!pending) {
      onDismiss();
    }
  };
  return (
    <AreaModal
      visible
      header={header}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} loading={pending} onClick={handleConfirm}>
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Box variant="p">{body}</Box>
    </AreaModal>
  );
}
