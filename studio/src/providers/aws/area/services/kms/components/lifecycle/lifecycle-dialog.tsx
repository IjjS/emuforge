import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, type ReactNode } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { FlashItem } from '../../../../components/page-flash';

export function LifecycleDialog({
  title,
  submitLabel,
  dismissLabel = 'Cancel',
  pending,
  disabled,
  blockedReason,
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
  blockedReason: string | undefined;
  failure: FlashItem | undefined;
  onDismiss: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const failureRef = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    if (failure !== undefined) failureRef.current?.focus();
  }, [failure]);

  const handleDismiss = () => {
    if (!pending) onDismiss();
  };
  const handleSubmit = () => {
    if (!pending && !disabled && blockedReason === undefined) onSubmit();
  };
  const notice = pending ? undefined : blockedReason;

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
            <Button
              variant="primary"
              disabled={!pending && (disabled || notice !== undefined)}
              {...(notice === undefined ? {} : { disabledReason: notice })}
              loading={pending}
              onClick={handleSubmit}
            >
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
            <Alert ref={failureRef} type="error" header={failure.header}>
              {failure.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
      <div role="status" aria-atomic="true">
        {notice !== undefined && (
          <Box margin={{ top: 'm' }}>
            <StatusIndicator type="warning">{notice}</StatusIndicator>
          </Box>
        )}
      </div>
    </AreaModal>
  );
}
