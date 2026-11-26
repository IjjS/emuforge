import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { DELETE_STAGE } from '../rest-stage-api';
import { useDeleteRestStage } from '../rest-stage-queries';

export function DeleteRestStageDialog({
  apiId,
  stageName,
  connection,
  onClose,
}: {
  apiId: string;
  stageName: string;
  connection: AreaConnection;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const flash = usePageFlash();
  const remove = useDeleteRestStage(apiId, connection.engineOrigin);
  const failure = remove.isError ? failureOf(remove.error, DELETE_STAGE) : undefined;
  const alert = failure && actionFailureItem(failure, failure.operation, connection.engineOrigin);
  const unavailable =
    typed !== stageName || connection.engineOrigin === undefined || failure?.kind === 'not-implemented';

  const handleDismiss = () => {
    if (!remove.isPending) onClose();
  };
  const handleDelete = () => {
    if (unavailable || remove.isPending) return;
    remove.mutate(stageName, {
      onSuccess: () => {
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
        onClose();
      },
    });
  };

  return (
    <AreaModal
      visible
      header={
        <>
          Delete stage <ValueText kind="name" value={stageName} />?
        </>
      }
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={remove.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={unavailable} loading={remove.isPending} onClick={handleDelete}>
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
            placeholder={stageName}
            onChange={({ detail }) => setTyped(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') handleDelete();
            }}
          />
        </FormField>
        {alert && (
          <Alert type={alert.type} header={alert.header}>
            {(failure?.kind === 'emulator-did-not-answer' || failure?.kind === 'engine-did-not-answer') && (
              <Box variant="strong">{failure.operation}</Box>
            )}
            {alert.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
