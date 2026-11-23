import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactNode } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ValueText } from '../../../../components/value-text';
import {
  DELETE_SECRET,
  deleteSecret,
  PUT_SECRET_VALUE,
  putSecretValue,
  RESTORE_SECRET,
  restoreSecret,
  TAG_RESOURCE,
  tagResource,
  UNTAG_RESOURCE,
  untagResource,
  UPDATE_SECRET,
  updateSecret,
} from '../../lifecycle-api';
import { LifecycleFeedback } from './lifecycle-feedback';
import { EMPTY_SECRET_DRAFT, hasValue, secretValueInput, type SecretDraft } from './secret-draft';
import { SecretValueFields } from './secret-value-fields';
import type { LifecycleAction } from './use-lifecycle-action';

export type SecretEdit =
  | { kind: 'description' | 'key' | 'value' | 'schedule' | 'permanent' | 'restore' | 'add-tag' }
  | { kind: 'edit-tag'; key: string; value: string }
  | { kind: 'remove-tag'; key: string };

interface Props {
  edit: SecretEdit;
  action: LifecycleAction;
  connection: AreaConnection;
  name: string;
  details: DescribeSecretCommandOutput;
  onClose: () => void;
  onSuccess: (endpoint: string, message: string) => void;
}

export function LifecycleDialog({ edit, action, connection, name, details, onClose, onSuccess }: Props) {
  const [text, setText] = useState(() => {
    if (edit.kind === 'description') return details.Description ?? '';
    if (edit.kind === 'key') return details.KmsKeyId ?? '';
    if (edit.kind === 'schedule') return '7';
    if (edit.kind === 'edit-tag') return edit.value;
    return '';
  });
  const [tagKey, setTagKey] = useState('');
  const [draft, setDraft] = useState<SecretDraft>(EMPTY_SECRET_DRAFT);
  const busy = action.pending !== undefined;
  const secret = { SecretId: name };
  const handleClose = () => {
    if (!busy) onClose();
  };

  let operation: string;
  let title: string;
  let label = 'Save changes';
  let message: string;
  let content: ReactNode;
  let ready = true;
  let send: (endpoint: string, signal: AbortSignal) => Promise<unknown>;

  switch (edit.kind) {
    case 'description':
      operation = UPDATE_SECRET;
      title = 'Edit description';
      message = 'Description updated.';
      ready = text !== (details.Description ?? '');
      content = (
        <FormField label="Description">
          <Textarea value={text} disabled={busy} onChange={({ detail }) => setText(detail.value)} />
        </FormField>
      );
      send = (endpoint, signal) => updateSecret(endpoint, { ...secret, Description: text }, signal);
      break;
    case 'key':
      operation = UPDATE_SECRET;
      title = 'Change encryption key';
      message = 'Encryption key updated.';
      ready = text.trim() !== '' && text.trim() !== details.KmsKeyId;
      content = (
        <FormField label="KMS key ARN" description="Use an existing KMS key in your local emulator.">
          <Input value={text} disabled={busy} onChange={({ detail }) => setText(detail.value)} />
        </FormField>
      );
      send = (endpoint, signal) => updateSecret(endpoint, { ...secret, KmsKeyId: text.trim() }, signal);
      break;
    case 'value':
      operation = PUT_SECRET_VALUE;
      title = 'Store new version';
      label = 'Store new version';
      message = 'New secret version stored.';
      ready = hasValue(draft);
      content = (
        <SpaceBetween size="m">
          <Box>The new version becomes current. Existing versions keep their original values.</Box>
          <SecretValueFields value={draft} disabled={busy} onChange={setDraft} />
        </SpaceBetween>
      );
      send = async (endpoint, signal) =>
        putSecretValue(endpoint, { ...secret, ...(await secretValueInput(draft, signal)) }, signal);
      break;
    case 'add-tag':
    case 'edit-tag': {
      operation = TAG_RESOURCE;
      title = edit.kind === 'edit-tag' ? 'Edit tag' : 'Add tag';
      label = edit.kind === 'edit-tag' ? 'Save tag' : 'Add tag';
      message = edit.kind === 'edit-tag' ? 'Tag updated.' : 'Tag added.';
      const key = edit.kind === 'edit-tag' ? edit.key : tagKey;
      ready = key.trim() !== '';
      content = (
        <SpaceBetween size="m">
          <FormField label="Tag key">
            <Input
              value={key}
              disabled={busy}
              readOnly={edit.kind === 'edit-tag'}
              onChange={({ detail }) => setTagKey(detail.value)}
            />
          </FormField>
          <FormField label="Tag value">
            <Input value={text} disabled={busy} onChange={({ detail }) => setText(detail.value)} />
          </FormField>
        </SpaceBetween>
      );
      send = (endpoint, signal) => tagResource(endpoint, { ...secret, Tags: [{ Key: key, Value: text }] }, signal);
      break;
    }
    case 'remove-tag':
      operation = UNTAG_RESOURCE;
      title = 'Remove tag';
      label = 'Remove tag';
      message = 'Tag removed.';
      content = (
        <Box>
          Remove the tag <ValueText kind="name" value={edit.key} /> from this secret?
        </Box>
      );
      send = (endpoint, signal) => untagResource(endpoint, { ...secret, TagKeys: [edit.key] }, signal);
      break;
    case 'schedule': {
      const days = Number(text);
      operation = DELETE_SECRET;
      title = 'Schedule deletion';
      label = 'Schedule deletion';
      message = `Deletion scheduled for ${name}.`;
      ready = /^\d+$/.test(text) && days >= 7 && days <= 30;
      content = (
        <SpaceBetween size="m">
          <Box>
            This secret will be scheduled for deletion in your local emulator. You can restore it during the recovery
            window.
          </Box>
          <FormField label="Recovery window (days)" constraintText="Enter a whole number from 7 to 30.">
            <Input
              type="number"
              inputMode="numeric"
              value={text}
              disabled={busy}
              onChange={({ detail }) => setText(detail.value)}
            />
          </FormField>
        </SpaceBetween>
      );
      send = (endpoint, signal) => deleteSecret(endpoint, { ...secret, RecoveryWindowInDays: days }, signal);
      break;
    }
    case 'permanent':
      operation = DELETE_SECRET;
      title = 'Permanently delete secret';
      label = 'Permanently delete';
      message = `Secret ${name} was permanently deleted.`;
      ready = text === name;
      content = (
        <SpaceBetween size="m">
          <Box>Permanently delete this secret from your local emulator? This cannot be undone.</Box>
          <FormField label={`Type ${name} to confirm.`}>
            <Input
              autoComplete={false}
              spellcheck={false}
              value={text}
              disabled={busy}
              onChange={({ detail }) => setText(detail.value)}
            />
          </FormField>
        </SpaceBetween>
      );
      send = (endpoint, signal) => deleteSecret(endpoint, { ...secret, ForceDeleteWithoutRecovery: true }, signal);
      break;
    case 'restore':
      operation = RESTORE_SECRET;
      title = 'Restore secret';
      label = 'Restore secret';
      message = 'Secret restored.';
      content = <Box>Cancel scheduled deletion for this secret in your local emulator?</Box>;
      send = (endpoint, signal) => restoreSecret(endpoint, secret, signal);
      break;
  }

  return (
    <AreaModal
      visible
      header={title}
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={busy} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!ready || busy || action.disabled(operation)}
              onClick={() => {
                if (ready) void action.run(operation, send, (_, endpoint) => onSuccess(endpoint, message));
              }}
            >
              {label}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="strong">
          <ValueText kind="name" value={name} />
        </Box>
        {content}
        <LifecycleFeedback action={action} connection={connection} what={title} />
      </SpaceBetween>
    </AreaModal>
  );
}
