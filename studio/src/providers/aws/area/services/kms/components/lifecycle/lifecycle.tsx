import type { KeyMetadata } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { ValueText } from '../../../../components/value-text';
import {
  cancelKeyDeletion,
  DELETION_WINDOW,
  disableKey,
  enableKey,
  LIFECYCLE_OPERATIONS,
  scheduleKeyDeletion,
  updateKeyDescription,
  type LifecycleOperation,
} from '../../lifecycle-api';
import { LifecycleDialog } from './lifecycle-dialog';
import { useLifecycleAction } from './use-lifecycle-action';

type Dialog = 'describe' | 'disable' | 'schedule' | 'cancel';

const RANGE_TEXT = `From ${String(DELETION_WINDOW.min)} to ${String(DELETION_WINDOW.max)} days.`;

/** The waiting period typed, when it is a whole number of days KMS accepts. */
function waitingDays(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const days = Number(text.trim());
  return days >= DELETION_WINDOW.min && days <= DELETION_WINDOW.max ? days : undefined;
}

function KeyName({ keyId }: { keyId: string }) {
  return <ValueText kind="name" value={keyId} />;
}

export interface LifecycleProps {
  connection: AreaConnection;
  metadata: KeyMetadata & { KeyId: string };
}

/** The lifecycle actions of a key, offered by the state DescribeKey last returned. */
export function Lifecycle({ connection, metadata }: LifecycleProps) {
  const keyId = metadata.KeyId;
  const state = metadata.KeyState;
  const action = useLifecycleAction(connection, keyId);
  const [dialog, setDialog] = useState<Dialog>();
  const [description, setDescription] = useState('');
  const [days, setDays] = useState(String(DELETION_WINDOW.max));
  const usable = state === 'Enabled' || state === 'Disabled';
  const pendingDeletion = state === 'PendingDeletion';

  const open = (next: Dialog) => {
    action.clearFailure();
    if (next === 'describe') setDescription(metadata.Description ?? '');
    if (next === 'schedule') setDays(String(DELETION_WINDOW.max));
    setDialog(next);
  };
  const close = () => {
    action.clearFailure();
    setDialog(undefined);
  };

  const unavailableReason = (operation: LifecycleOperation) =>
    action.isUnavailable(operation) ? `Not implemented by the emulator (${operation})` : undefined;

  const control = (operation: LifecycleOperation, label: string, allowed: boolean, onClick: () => void) => {
    const reason = unavailableReason(operation);
    return (
      <Button
        disabled={!allowed || action.disabled(operation)}
        {...(reason === undefined ? {} : { disabledReason: reason })}
        loading={dialog === undefined && action.pending === operation}
        onClick={onClick}
      >
        {label}
      </Button>
    );
  };

  const handleEnable = () =>
    void action.run(
      LIFECYCLE_OPERATIONS.enable,
      (endpoint, signal) => enableKey(endpoint, keyId, signal),
      'Key enabled.',
    );

  const scheduledDays = waitingDays(days);

  return (
    <>
      <div role="group" aria-label="Key lifecycle">
        <SpaceBetween direction="horizontal" size="xs">
          {control(LIFECYCLE_OPERATIONS.describe, 'Edit description', usable, () => open('describe'))}
          {state === 'Disabled'
            ? control(LIFECYCLE_OPERATIONS.enable, 'Enable key', true, handleEnable)
            : control(LIFECYCLE_OPERATIONS.disable, 'Disable key', state === 'Enabled', () => open('disable'))}
          {pendingDeletion
            ? control(LIFECYCLE_OPERATIONS.cancel, 'Cancel key deletion', true, () => open('cancel'))
            : control(LIFECYCLE_OPERATIONS.schedule, 'Schedule key deletion', usable, () => open('schedule'))}
        </SpaceBetween>
      </div>

      {dialog === 'describe' && (
        <LifecycleDialog
          title="Edit description"
          submitLabel="Save"
          pending={action.pending !== undefined}
          disabled={description === (metadata.Description ?? '')}
          failure={action.failure}
          onDismiss={close}
          onSubmit={() =>
            void action.run(
              LIFECYCLE_OPERATIONS.describe,
              (endpoint, signal) => updateKeyDescription(endpoint, keyId, description, signal),
              'Key description updated.',
              close,
            )
          }
        >
          <FormField label="Description" constraintText="Leave empty to clear the description.">
            <Textarea
              value={description}
              disabled={action.pending !== undefined}
              onChange={({ detail }) => setDescription(detail.value)}
            />
          </FormField>
        </LifecycleDialog>
      )}

      {dialog === 'disable' && (
        <LifecycleDialog
          title="Disable key"
          submitLabel="Disable key"
          pending={action.pending !== undefined}
          disabled={false}
          failure={action.failure}
          onDismiss={close}
          onSubmit={() =>
            void action.run(
              LIFECYCLE_OPERATIONS.disable,
              (endpoint, signal) => disableKey(endpoint, keyId, signal),
              'Key disabled.',
              close,
            )
          }
        >
          <Box variant="p">
            Disable key <KeyName keyId={keyId} />?
          </Box>
          <Box variant="p">
            While it is disabled, your local emulator refuses every cryptographic operation that uses this key, such as
            Encrypt and Decrypt, for any application that calls it. You can enable it again.
          </Box>
        </LifecycleDialog>
      )}

      {dialog === 'schedule' && (
        <LifecycleDialog
          title="Schedule key deletion"
          submitLabel="Schedule deletion"
          pending={action.pending !== undefined}
          disabled={scheduledDays === undefined}
          failure={action.failure}
          onDismiss={close}
          onSubmit={() => {
            if (scheduledDays === undefined) return;
            void action.run(
              LIFECYCLE_OPERATIONS.schedule,
              (endpoint, signal) => scheduleKeyDeletion(endpoint, keyId, scheduledDays, signal),
              'Key deletion scheduled.',
              close,
            );
          }}
        >
          <Box variant="p">
            Schedule the deletion of key <KeyName keyId={keyId} />?
          </Box>
          <Box variant="p">
            Until the waiting period ends the key cannot be used and you can cancel the deletion. Then your local
            emulator deletes the key, and data encrypted under it can no longer be decrypted.
          </Box>
          <FormField
            label="Waiting period (days)"
            constraintText={RANGE_TEXT}
            errorText={scheduledDays === undefined ? `Enter a whole number of days. ${RANGE_TEXT}` : undefined}
          >
            <Input
              type="number"
              inputMode="numeric"
              value={days}
              disabled={action.pending !== undefined}
              onChange={({ detail }) => setDays(detail.value)}
            />
          </FormField>
        </LifecycleDialog>
      )}

      {dialog === 'cancel' && (
        <LifecycleDialog
          title="Cancel key deletion"
          submitLabel="Cancel deletion"
          dismissLabel="Keep scheduled"
          pending={action.pending !== undefined}
          disabled={false}
          failure={action.failure}
          onDismiss={close}
          onSubmit={() =>
            void action.run(
              LIFECYCLE_OPERATIONS.cancel,
              (endpoint, signal) => cancelKeyDeletion(endpoint, keyId, signal),
              'Key deletion canceled.',
              close,
            )
          }
        >
          <Box variant="p">
            Cancel the scheduled deletion of key <KeyName keyId={keyId} />?
          </Box>
          <Box variant="p">
            The key stays in your local emulator in the state KMS returns, usually disabled. Enable it to use it again.
          </Box>
        </LifecycleDialog>
      )}
    </>
  );
}
