import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { useDeleteV2Stage } from '../v2-stage-queries';
import { RestChangeFailure } from './delete-resource-dialog';

export function DeleteV2StageDialog({
  apiId,
  stageName,
  endpoint,
  onDeleted,
  onClose,
}: {
  apiId: string;
  stageName: string;
  endpoint: string | undefined;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const flash = usePageFlash();
  const remove = useDeleteV2Stage(apiId, endpoint);
  const canDelete = typed === stageName && remove.available;

  function handleClose() {
    if (!remove.isPending) onClose();
  }

  function handleDelete() {
    if (!canDelete || remove.isPending) return;
    remove.submit(stageName, () => {
      flash.show([
        {
          type: 'success',
          content: (
            <>
              Stage <ValueText kind="name" value={stageName} /> deleted.
            </>
          ),
        },
      ]);
      onDeleted();
      onClose();
    });
  }

  return (
    <AreaModal
      visible
      header={
        <>
          Delete stage <ValueText kind="name" value={stageName} />?
        </>
      }
      closeAriaLabel="Close dialog"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={remove.isPending} onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canDelete} loading={remove.isPending} onClick={handleDelete}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">Its invoke URL stops answering. It cannot be undone.</Box>
        <FormField
          label={
            <>
              To confirm, type “<ValueText kind="name" value={stageName} />” in the field.
            </>
          }
        >
          <Input
            value={typed}
            readOnly={remove.isPending}
            onChange={({ detail }) => setTyped(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') handleDelete();
            }}
          />
        </FormField>
        {remove.failure && <RestChangeFailure failure={remove.failure} endpoint={endpoint} />}
      </SpaceBetween>
    </AreaModal>
  );
}
