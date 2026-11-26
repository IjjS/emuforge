import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { reportedNotImplementedMessage } from '../../../../../../lib/aws/request';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem, type FlashResult } from '../../../components/page-flash';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { createRoutePath, integrationTypeText } from '../format';
import type { AppendedPages } from '../queries';
import { routeIntegration } from '../v2-format';
import type { IntegrationDeletionWarning } from '../v2-route-change-api';
import { DeleteRouteDialog } from './delete-route-dialog';
import { RequestReadFailure } from './request-read-failure';
import { V2PartHeading } from './v2-details';

interface V2RoutesProps {
  id: string;
  isHttp: boolean;
  routes: AppendedPages<Route>;
  integrations: readonly Integration[];
  connection: AreaConnection;
}

export function V2Routes({ id, isHttp, routes, integrations, connection }: V2RoutesProps) {
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<Route & { RouteId: string }>();
  const selected = routes.items?.find((route) => route.RouteId !== undefined && route.RouteId === selectedId);
  const failure =
    routes.failure === undefined ? null : (
      <RequestReadFailure failure={routes.failure} connection={connection} thing="routes" onRetry={routes.retry} />
    );

  function integrationWarning(routeKey: string, { integrationId, failure }: IntegrationDeletionWarning): FlashItem {
    const item = actionFailureItem(failure, failure.operation, connection.engineOrigin);
    const message = reportedNotImplementedMessage(failure);
    return {
      type: 'warning',
      content: (
        <>
          Route <ValueText kind="name" value={routeKey} /> deleted, but its integration{' '}
          <CopyValue kind="name" label="integration ID" value={integrationId} /> was not:{' '}
          {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
            `${failure.operation}: `}
          {item.header}
          {item.content && <>. {item.content}</>}
          {message && (
            <>
              {' '}
              <ValueText kind="text" value={message} />
            </>
          )}
        </>
      ),
    };
  }

  function handleDeleted(route: Route & { RouteId: string }, warning: IntegrationDeletionWarning | undefined) {
    const routeKey = route.RouteKey ?? route.RouteId;
    const success: FlashItem = {
      type: 'success',
      content: (
        <>
          Route <ValueText kind="name" value={routeKey} /> deleted.
        </>
      ),
    };
    const result: FlashResult = warning === undefined ? [success] : [success, integrationWarning(routeKey, warning)];
    // Commit the visible result and dialog closure before the mutation hook refreshes.
    flushSync(() => {
      flash.show(result);
      setDeleting(undefined);
      setSelectedId(undefined);
    });
  }

  return (
    <>
      <Table<Route>
        ariaLabels={{
          tableLabel: 'Routes',
          selectionGroupLabel: 'Route selection',
          itemSelectionLabel: (_, route) => `Select ${route.RouteKey ?? route.RouteId ?? 'route'}`,
        }}
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => void routes.refresh()} iconName="refresh">
                  Refresh
                </Button>
                <Button
                  disabled={!selected?.RouteId}
                  onClick={() => {
                    if (selected?.RouteId) setDeleting({ ...selected, RouteId: selected.RouteId });
                  }}
                >
                  Delete
                </Button>
                {isHttp && (
                  <Button href={createRoutePath(id)} onFollow={handleFollow}>
                    Create route
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <V2PartHeading part="routes">Routes</V2PartHeading>
          </Header>
        }
        items={routes.items ?? []}
        trackBy={(route) => route.RouteId ?? route.RouteKey ?? ''}
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => setSelectedId(detail.selectedItems[0]?.RouteId)}
        wrapLines
        columnDefinitions={[
          {
            id: 'key',
            header: 'Route key',
            isRowHeader: true,
            minWidth: '24ch',
            cell: (route) => <ValueText kind="name" value={route.RouteKey} none="-" />,
          },
          {
            id: 'authorization',
            header: 'Authorization',
            cell: (route) => <ValueText kind="fixed" value={route.AuthorizationType} none="-" />,
          },
          {
            id: 'kind',
            header: 'Integration',
            cell: (route) => {
              const { integration } = routeIntegration(route, integrations);
              return (
                <ValueText
                  kind="fixed"
                  value={integration?.IntegrationType && integrationTypeText(integration.IntegrationType)}
                  none="-"
                />
              );
            },
          },
          {
            id: 'target',
            header: 'Target',
            minWidth: '28ch',
            cell: (route) => {
              const { integration, id: integrationId } = routeIntegration(route, integrations);
              return integration === undefined ? (
                <CopyValue kind="name" label="integration ID" value={integrationId} none="-" />
              ) : (
                <CopyValue label="target" value={integration.IntegrationUri} none="-" />
              );
            },
          },
        ]}
        loading={routes.items === undefined && routes.loading}
        loadingText="Loading routes…"
        empty={
          failure ?? (
            <Box variant="strong" textAlign="center">
              No routes
            </Box>
          )
        }
        footer={
          (routes.more || (failure !== null && (routes.items?.length ?? 0) > 0)) && (
            <SpaceBetween size="s">
              {(routes.items?.length ?? 0) > 0 && failure}
              {routes.more && (
                <Button loading={routes.loading} onClick={routes.loadMore}>
                  Load more routes
                </Button>
              )}
            </SpaceBetween>
          )
        }
      />
      {deleting && (
        <DeleteRouteDialog
          apiId={id}
          route={deleting}
          connection={connection}
          onDeleted={(warning) => handleDeleted(deleting, warning)}
          onDismiss={() => setDeleting(undefined)}
        />
      )}
    </>
  );
}
