import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { LifecycleFeedback } from '../lifecycle/lifecycle-feedback';
import type { LifecycleAction } from '../lifecycle/use-lifecycle-action';

export type ChangeDialogContext = {
  action: LifecycleAction;
  connection: AreaConnection;
  name: string;
  onClose: () => void;
  onSaved: (origin: string, message: string) => void;
};

export function ChangeDialog({
  action,
  connection,
  onClose,
  onSaved,
  operation,
  title,
  submit,
  result,
  valid = true,
  send,
  children,
}: Omit<ChangeDialogContext, 'name'> & {
  operation: string;
  title: string;
  submit: string;
  result: string;
  valid?: boolean;
  send: (endpoint: string, signal: AbortSignal) => Promise<unknown>;
  children: ReactNode;
}) {
  const pending = action.pending !== undefined;
  const disabled = pending || !valid || action.disabled(operation);
  const handleDismiss = () => {
    if (!pending) onClose();
  };
  const handleSubmit = () => {
    if (disabled) return;
    void action.run(operation, send, (_, origin) => {
      onClose();
      onSaved(origin, result);
    });
  };

  return (
    <AreaModal
      visible
      header={title}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={disabled} loading={action.pending === operation}>
              {submit}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {children}
        <LifecycleFeedback action={action} connection={connection} what={title} />
      </SpaceBetween>
    </AreaModal>
  );
}
