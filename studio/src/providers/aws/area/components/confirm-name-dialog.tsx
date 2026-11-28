import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactNode } from 'react';

import { AreaModal } from './area-modal';
import { normalizeLineBreaks } from './name-segment';

interface ConfirmNameDialogProps {
  visible: boolean;
  header: ReactNode;
  body: ReactNode;
  label: string;
  name: string;
  action: string;
  pending: boolean;
  multiline?: boolean;
  nameCopy?: ReactNode;
  unavailable?: ReactNode;
  feedback?: ReactNode;
  onConfirm: () => void;
  onDismiss: () => void;
}

function Dialog({
  header,
  body,
  label,
  name,
  action,
  pending,
  multiline,
  nameCopy,
  unavailable,
  feedback,
  onConfirm,
  onDismiss,
}: Omit<ConfirmNameDialogProps, 'visible'>) {
  const [typed, setTyped] = useState('');
  const enteredName = multiline ? normalizeLineBreaks(typed) : typed;
  const canConfirm = enteredName === name && !pending && unavailable === undefined;
  const handleConfirm = () => {
    if (canConfirm) onConfirm();
  };
  const handleDismiss = () => {
    if (!pending) onDismiss();
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
            <Button variant="primary" disabled={!canConfirm} loading={pending} onClick={handleConfirm}>
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">{body}</Box>
        {unavailable}
        {feedback}
        {nameCopy}
        <FormField label={label}>
          {multiline ? (
            <Textarea
              rows={2}
              resize="vertical"
              value={typed}
              readOnly={pending}
              autoComplete={false}
              spellcheck={false}
              onChange={({ detail }) => setTyped(detail.value)}
            />
          ) : (
            <Input
              value={typed}
              readOnly={pending}
              autoComplete={false}
              spellcheck={false}
              onChange={({ detail }) => setTyped(detail.value)}
              onKeyDown={({ detail }) => {
                if (detail.key === 'Enter' && !detail.isComposing) handleConfirm();
              }}
            />
          )}
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}

export function ConfirmNameDialog({ visible, ...props }: ConfirmNameDialogProps) {
  return visible ? <Dialog {...props} /> : null;
}
