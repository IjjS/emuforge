import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode } from 'react';

import { AreaModal } from './area-modal';

// The area's dialog of a removal that cannot be undone, on the area's `AreaModal`, confirmed by typing a word
// (`aws-area.md`, "Inside the area: Cloudscape"). Lifted from SQS (issue 481: "Delete" of messages, "Purge" of a
// queue) when DynamoDB became the second service to need it (issue 496: delete items, delete a table).

export interface ConfirmDialogProps {
  visible: boolean;
  header: ReactNode;
  body: ReactNode;
  /** The word the field must hold, exactly, and the action's button. */
  word: string;
  action: string;
  /** The action's request is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

function Dialog({ header, body, word, action, pending, onConfirm, onDismiss }: Omit<ConfirmDialogProps, 'visible'>) {
  const [typed, setTyped] = useState('');
  const confirmed = typed === word;
  const handleConfirm = () => {
    if (confirmed && !pending) {
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
            <Button variant="primary" disabled={!confirmed || pending} loading={pending} onClick={handleConfirm}>
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">{body}</Box>
        <FormField label={`To confirm, type “${word}” in the field.`}>
          <Input
            value={typed}
            placeholder={word}
            onChange={({ detail }) => {
              setTyped(detail.value);
            }}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') {
                handleConfirm();
              }
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}

/** The dialog, mounted only while it is shown, so its field starts empty at each opening. */
export function ConfirmDialog({ visible, ...props }: ConfirmDialogProps) {
  return visible ? <Dialog {...props} /> : null;
}
