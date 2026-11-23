import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ValueText } from '../../../components/value-text';
import type { ObjectVersion } from '../api';
import { useRestoreVersioning } from '../queries';
import { versionFailure } from './object-versions-failure';
import { confirmsName } from './confirms-name';

export type VersionTarget = ObjectVersion & { versionId: string };

export const RESTORE_VERSION = 'Restore version';
export const REMOVE_MARKER = 'Remove delete marker';

const JSON_KEY_PREFIX = 'JSON ';

interface ObjectVersionsDialogProps {
  endpoint: string | undefined;
  bucket: string;
  target: VersionTarget;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ObjectVersionsDialog({
  endpoint,
  bucket,
  target,
  pending,
  onCancel,
  onConfirm,
}: ObjectVersionsDialogProps) {
  const restoring = target.kind === 'version';
  const label = restoring ? RESTORE_VERSION : REMOVE_MARKER;
  const read = useRestoreVersioning(endpoint, bucket, restoring);
  const status = read.value?.status;
  const ready = !restoring || (!read.loading && read.failure === undefined && status !== undefined);
  const failure =
    read.failure === undefined ? undefined : versionFailure(read.failure, 'Reading bucket versioning', endpoint);
  const [typed, setTyped] = useState('');
  // A textarea normalizes CR. Reserve a prefix for the escaped form so it cannot also be a raw confirmation.
  const escaped = target.key.includes('\r') || target.key.startsWith(JSON_KEY_PREFIX);
  const expected = escaped ? JSON_KEY_PREFIX + JSON.stringify(target.key) : target.key;
  const matches = typed !== '' && confirmsName(typed, expected);

  return (
    <AreaModal
      visible
      header={label}
      closeAriaLabel="Close"
      onDismiss={onCancel}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={!ready || !matches} onClick={onConfirm}>
              {label}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <KeyValuePairs
          items={[
            {
              label: 'Key',
              value: (
                <Box nativeAttributes={{ style: { whiteSpace: 'break-spaces' } }}>
                  <ValueText kind="name" value={expected} />
                </Box>
              ),
            },
            {
              label: restoring ? 'Source version ID' : 'Delete marker version ID',
              value: <ValueText kind="name" value={target.versionId} />,
            },
            ...(restoring && status !== undefined ? [{ label: 'Bucket versioning', value: status }] : []),
          ]}
        />
        {restoring ? (
          <Box variant="p">The selected version’s contents will become the current object.</Box>
        ) : (
          <Box variant="p">
            {target.latest
              ? 'Removing this marker can make an earlier version visible as the current object.'
              : 'The selected marker will be removed from the object’s version history.'}
          </Box>
        )}
        {restoring && (
          <Alert type="warning">
            If versioning is suspended when you restore, the restored version replaces any existing null version of this
            key.
          </Alert>
        )}
        {restoring && read.loading && <StatusIndicator type="loading">Loading bucket versioning</StatusIndicator>}
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header} action={<Button onClick={read.again}>Retry</Button>}>
            {failure.detail}
          </Alert>
        )}
        <FormField
          label="Enter the full key to confirm"
          description={escaped ? 'Enter the JSON prefix and quoted key exactly as shown.' : undefined}
          errorText={typed !== '' && !matches ? 'Enter the exact key shown above.' : undefined}
        >
          <Textarea
            value={typed}
            disabled={pending}
            rows={expected.includes('\n') ? 3 : 2}
            spellcheck={false}
            onChange={({ detail }) => setTyped(detail.value)}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
