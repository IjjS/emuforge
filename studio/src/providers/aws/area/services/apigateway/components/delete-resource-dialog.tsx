import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import { useDeleteResource } from '../rest-change-queries';

export function RestChangeFailure({ failure, endpoint }: { failure: RequestFailure; endpoint: string | undefined }) {
  const item = actionFailureItem(failure, failure.operation, endpoint);
  return (
    <div role="alert">
      <Alert type={item.type === 'info' ? 'info' : 'error'} header={item.header}>
        {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
          `${failure.operation} got no answer. `}
        {item.content}
      </Alert>
    </div>
  );
}

interface RestDeleteDialogProps {
  header: ReactNode;
  sentence: string;
  word: string;
  endpoint: string | undefined;
  change: { isPending: boolean; available: boolean; failure: RequestFailure | undefined };
  onConfirm: () => void;
  onDismiss: () => void;
}

export function RestDeleteDialog({
  header,
  sentence,
  word,
  endpoint,
  change,
  onConfirm,
  onDismiss,
}: RestDeleteDialogProps) {
  const [typed, setTyped] = useState('');
  const canDelete = typed === word && change.available && !change.isPending;

  function handleConfirm() {
    if (canDelete) onConfirm();
  }

  function handleDismiss() {
    if (!change.isPending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header={header}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={change.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canDelete} loading={change.isPending} onClick={handleConfirm}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">{sentence}</Box>
        <FormField
          label={
            <>
              To confirm, type “<ValueText kind="address" value={word} />” in the field.
            </>
          }
        >
          <Input
            value={typed}
            onChange={({ detail }) => setTyped(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') handleConfirm();
            }}
          />
        </FormField>
        {change.failure && <RestChangeFailure failure={change.failure} endpoint={endpoint} />}
      </SpaceBetween>
    </AreaModal>
  );
}

interface DeleteResourceDialogProps {
  endpoint: string | undefined;
  apiId: string;
  resourceId: string;
  path: string;
  onDeleted: () => void;
  onDismiss: () => void;
}

export function DeleteResourceDialog({
  endpoint,
  apiId,
  resourceId,
  path,
  onDeleted,
  onDismiss,
}: DeleteResourceDialogProps) {
  const change = useDeleteResource(endpoint, apiId, onDeleted);
  return (
    <RestDeleteDialog
      header={
        <>
          Delete resource <ValueText kind="address" value={path} />?
        </>
      }
      sentence="This also removes the resources and methods below it. It cannot be undone."
      word={path}
      endpoint={endpoint}
      change={change}
      onConfirm={() => change.submit(resourceId)}
      onDismiss={onDismiss}
    />
  );
}
