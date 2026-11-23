import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { FlashItem } from '../../../../components/page-flash';

export function LifecycleDialog({
  title,
  submitLabel,
  dismissLabel = 'Cancel',
  pending,
  disabled,
  failure,
  onDismiss,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
  dismissLabel?: string;
  pending: boolean;
  disabled: boolean;
  failure: FlashItem | undefined;
  onDismiss: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const handleDismiss = () => {
    if (!pending) onDismiss();
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
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              {dismissLabel}
            </Button>
            <Button variant="primary" disabled={disabled || pending} loading={pending} onClick={onSubmit}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {children}
        {failure !== undefined && (
          <div role="alert">
            <Alert type="error" header={failure.header}>
              {failure.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
