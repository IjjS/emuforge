import type { Route } from '@aws-sdk/client-apigatewayv2';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import { routeIntegrationId } from '../v2-format';
import type { IntegrationDeletionWarning } from '../v2-route-change-api';
import { useDeleteV2Route, useRouteIntegrationCheck } from '../v2-route-change-queries';
import { RestChangeFailure } from './delete-resource-dialog';
import { RequestReadFailure } from './request-read-failure';

interface DeleteRouteDialogProps {
  apiId: string;
  route: Route & { RouteId: string };
  connection: AreaConnection;
  onDeleted: (warning: IntegrationDeletionWarning | undefined) => void;
  onDismiss: () => void;
}

export function DeleteRouteDialog({ apiId, route, connection, onDeleted, onDismiss }: DeleteRouteDialogProps) {
  const [typed, setTyped] = useState('');
  const endpoint = connection.engineOrigin;
  const integrationId = routeIntegrationId(route);
  const check = useRouteIntegrationCheck(endpoint, apiId, route.RouteId, integrationId);
  const change = useDeleteV2Route(endpoint, apiId, onDeleted);
  const canDelete = typed === 'delete' && check.ready && change.available && !change.isPending;

  function handleConfirm() {
    if (!canDelete) return;
    change.submit({
      routeId: route.RouteId,
      ...(check.exclusive && integrationId !== undefined && { integrationId }),
    });
  }

  function handleDismiss() {
    if (!change.isPending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header={
        <>
          Delete route <ValueText kind="name" value={route.RouteKey ?? route.RouteId} />?
        </>
      }
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
        <Box variant="p">It cannot be undone.</Box>
        {check.loading && (
          <StatusIndicator type="loading">
            Checking whether another route uses integration{' '}
            <CopyValue kind="name" label="integration ID" value={integrationId} />…
          </StatusIndicator>
        )}
        {check.exclusive && (
          <Box variant="p">
            Its integration <CopyValue kind="name" label="integration ID" value={integrationId} /> is used by no other
            route and is deleted with it.
          </Box>
        )}
        {check.failure && (
          <RequestReadFailure failure={check.failure} connection={connection} thing="routes" onRetry={check.retry} />
        )}
        <FormField label="To confirm, type “delete” in the field.">
          <Input
            value={typed}
            readOnly={change.isPending}
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
