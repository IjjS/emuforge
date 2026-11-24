import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { AreaModal, type AreaModalProps } from '../../../../components/area-modal';

export function AccessDialog({
  title,
  submitLabel,
  size,
  pending,
  disabled,
  onDismiss,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
  size?: AreaModalProps['size'];
  pending: boolean;
  disabled: boolean;
  onDismiss: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  function handleDismiss() {
    if (!pending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header={title}
      {...(size === undefined ? {} : { size })}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!pending && disabled} loading={pending} onClick={onSubmit}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">{children}</SpaceBetween>
    </AreaModal>
  );
}
