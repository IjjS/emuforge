import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { useFollow } from '../../../components/use-follow';
import type { NotificationConfiguration } from '../api';
import { createEventNotificationPath, editEventNotificationPath } from '../format';
import {
  editableNotification,
  notificationIdCounts,
  notificationRules,
  type EditableNotification,
} from '../notifications';
import { NotificationTable } from './notification-table';
import { Quoted } from './quoted';

export function NotificationSection({
  bucket,
  configuration,
  loading,
  failure,
  feedback,
  unsupported,
  deleteDisabled,
  onDelete,
}: {
  bucket: string;
  configuration: NotificationConfiguration | undefined;
  loading: boolean;
  failure?: ReactNode;
  feedback: ReactNode;
  unsupported: boolean;
  deleteDisabled: boolean;
  onDelete: (target: EditableNotification) => void;
}) {
  const follow = useFollow();
  const ids = notificationIdCounts(notificationRules(configuration ?? {}));
  return (
    <SpaceBetween size="s">
      {feedback}
      <NotificationTable
        configuration={configuration}
        loading={loading}
        failure={failure}
        header={(compact) => (
          <Header
            variant="h2"
            description={compact ? 'Scroll sideways for event types and filters.' : undefined}
            actions={
              <Button href={createEventNotificationPath(bucket)} onFollow={follow} disabled={unsupported}>
                Create event notification
              </Button>
            }
          >
            Event notifications
          </Header>
        )}
        actions={(rule) => {
          const id = rule.data.Id;
          if (!editableNotification(rule, ids) || id === undefined) return <Box>Read only</Box>;
          return (
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                href={editEventNotificationPath(bucket, id)}
                onFollow={follow}
                wrapText={false}
                ariaLabel={`Edit ${id}`}
              >
                Edit
              </Button>
              <Button
                onClick={() => onDelete(rule)}
                disabled={deleteDisabled}
                wrapText={false}
                ariaLabel={`Delete ${id}`}
              >
                Delete
              </Button>
            </SpaceBetween>
          );
        }}
      />
    </SpaceBetween>
  );
}

export function DeleteNotificationDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: EditableNotification;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AreaModal
      visible
      header="Delete event notification"
      closeAriaLabel="Close"
      onDismiss={onCancel}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Quoted before="Stop sending matching events for " name={target.data.Id ?? ''} after="?" />
    </AreaModal>
  );
}
