import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ValueText } from '../../../components/value-text';
import { NO_SUCH_BUCKET, type ObjectVersion } from '../api';
import { useBucketProperty } from '../queries';
import { versionFailure } from './object-versions-failure';
import { confirmsName } from './confirms-name';

export type VersionTarget = ObjectVersion & { versionId: string };

export const RESTORE_VERSION = 'Restore version';
export const REMOVE_MARKER = 'Remove delete marker';

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
  const read = useBucketProperty(endpoint, bucket, 'versioning', { generation: 0, enabled: restoring });
  const status = read.value === NO_SUCH_BUCKET ? undefined : read.value?.status;
  const ready = !restoring || (!read.loading && read.failure === undefined && status !== undefined);
  const failure =
    read.failure === undefined ? undefined : versionFailure(read.failure, 'Reading bucket versioning', endpoint);
  const [typed, setTyped] = useState('');
  const matches = typed !== '' && confirmsName(typed, target.key);

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
                  <ValueText kind="name" value={target.key} />
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
        {read.value === NO_SUCH_BUCKET && (
          <Alert type="error" header="NoSuchBucket" action={<Button onClick={read.again}>Retry</Button>}>
            The local emulator holds no bucket of this name.
          </Alert>
        )}
        <FormField
          label="Enter the full key to confirm"
          errorText={typed !== '' && !matches ? 'Enter the exact key shown above.' : undefined}
        >
          <Input
            value={typed}
            disabled={pending}
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => setTyped(detail.value)}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
