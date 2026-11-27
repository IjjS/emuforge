import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';
import { deleteApiOperation, type DeleteApiTarget } from '../api-delete-api';
import { useDeleteApi } from '../api-delete-queries';

interface DeleteApiDialogProps {
  api: DeleteApiTarget;
  endpoint: string | undefined;
  onDeleted: (api: DeleteApiTarget) => void;
  onDismiss: () => void;
}

export function DeleteApiDialog({ api, endpoint, onDeleted, onDismiss }: DeleteApiDialogProps) {
  const [typedName, setTypedName] = useState('');
  const pageSignal = usePageSignal();
  const deletion = useDeleteApi(endpoint, onDeleted);
  const operation = deleteApiOperation(api.kind);
  const failure = deletion.isError ? failureOf(deletion.error, operation) : undefined;
  const item = failure === undefined ? undefined : actionFailureItem(failure, operation, endpoint);
  const canDelete =
    typedName === api.name && endpoint !== undefined && !deletion.isPending && failure?.kind !== 'not-implemented';

  function handleConfirm() {
    if (canDelete) deletion.mutate({ api, signal: pageSignal() });
  }

  function handleDismiss() {
    if (!deletion.isPending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header={
        <>
          Delete API <NameText name={api.name} />?
        </>
      }
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={deletion.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canDelete} loading={deletion.isPending} onClick={handleConfirm}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          This removes the API with its resources, methods, routes and stages from the local emulator. It cannot be
          undone.
        </Box>
        <FormField
          label={
            <>
              To confirm, type “<ValueText kind="name" value={api.name} />” in the field.
            </>
          }
        >
          <Input
            value={typedName}
            onChange={({ detail }) => setTypedName(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') handleConfirm();
            }}
          />
        </FormField>
        {item !== undefined && (
          <div role="alert">
            <Alert type={item.type === 'info' ? 'info' : 'error'} header={item.header}>
              {(failure?.kind === 'engine-did-not-answer' || failure?.kind === 'emulator-did-not-answer') && (
                <> {operation} got no answer. </>
              )}
              {item.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
