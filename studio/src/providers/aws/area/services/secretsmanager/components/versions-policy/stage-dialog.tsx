import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ValueText } from '../../../../components/value-text';
import { UPDATE_SECRET_VERSION_STAGE, updateSecretVersionStage } from '../../versions-policy-api';
import { LifecycleFeedback } from '../lifecycle/lifecycle-feedback';
import type { LifecycleAction } from '../lifecycle/use-lifecycle-action';

export type StageEdit =
  | { kind: 'add'; version: string; existing: string[] }
  | { kind: 'move'; version: string; labels: { label: string; source: string }[] }
  | { kind: 'remove'; version: string; labels: string[] };

const WORDING = {
  add: { title: 'Add staging label', target: 'Version', result: 'Staging label added.' },
  move: { title: 'Move staging label', target: 'Destination version', result: 'Staging label moved.' },
  remove: { title: 'Remove staging label', target: 'Version', result: 'Staging label removed.' },
};

export function StageDialog({
  action,
  connection,
  edit,
  name,
  onClose,
  onSaved,
}: {
  action: LifecycleAction;
  connection: AreaConnection;
  edit: StageEdit;
  name: string;
  onClose: () => void;
  onSaved: (origin: string, message: string) => void;
}) {
  const [label, setLabel] = useState('');
  const wording = WORDING[edit.kind];
  const pending = action.pending !== undefined;
  const duplicate = edit.kind === 'add' && edit.existing.includes(label);
  const options =
    edit.kind === 'move'
      ? edit.labels.map(({ label, source }) => ({ label, value: label, description: source }))
      : edit.kind === 'remove'
        ? edit.labels.map((label) => ({ label, value: label }))
        : [];
  const disabled = label.trim() === '' || duplicate || pending || action.disabled(UPDATE_SECRET_VERSION_STAGE);

  const handleSubmit = () => {
    if (disabled) return;
    const source = edit.kind === 'move' ? edit.labels.find((entry) => entry.label === label)?.source : edit.version;
    void action.run(
      UPDATE_SECRET_VERSION_STAGE,
      (endpoint, signal) =>
        updateSecretVersionStage(
          endpoint,
          {
            SecretId: name,
            VersionStage: label,
            ...(edit.kind !== 'remove' && { MoveToVersionId: edit.version }),
            ...(edit.kind !== 'add' && { RemoveFromVersionId: source }),
          },
          signal,
        ),
      (_, origin) => onSaved(origin, wording.result),
    );
  };

  const handleDismiss = () => {
    if (!pending) onClose();
  };

  return (
    <AreaModal
      visible
      header={wording.title}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={disabled} onClick={handleSubmit}>
              {wording.title}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box>
          <Box variant="strong">{wording.target}</Box>
          <ValueText kind="name" value={edit.version} />
        </Box>
        <FormField
          label="Staging label"
          errorText={
            duplicate ? 'This label is already attached. Use Move staging label here to transfer it.' : undefined
          }
        >
          {edit.kind === 'add' ? (
            <Input value={label} onChange={({ detail }) => setLabel(detail.value)} disabled={pending} />
          ) : (
            <Select
              options={options}
              selectedOption={options.find(({ value }) => value === label) ?? null}
              onChange={({ detail }) => setLabel(detail.selectedOption.value ?? '')}
              disabled={pending}
              placeholder="Choose a staging label"
            />
          )}
        </FormField>
        <LifecycleFeedback action={action} connection={connection} what={wording.title} />
      </SpaceBetween>
    </AreaModal>
  );
}
