import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { AppendedPages } from '../queries';
import { integrationRoutes } from '../v2-format';
import { RequestReadFailure } from './request-read-failure';
import { V2PartHeading } from './v2-details';

interface V2IntegrationsProps {
  integrations: AppendedPages<Integration>;
  routes: AppendedPages<Route>;
  connection: AreaConnection;
}

export function V2Integrations({ integrations, routes, connection }: V2IntegrationsProps) {
  const routesComplete = routes.items !== undefined && !routes.loading && !routes.more && routes.failure === undefined;
  const failure =
    integrations.failure === undefined ? null : (
      <RequestReadFailure
        failure={integrations.failure}
        connection={connection}
        thing="integrations"
        onRetry={integrations.retry}
      />
    );

  return (
    <Table<Integration>
      ariaLabels={{ tableLabel: 'Integrations' }}
      header={
        <Header
          variant="h2"
          actions={
            <Button onClick={() => void integrations.refresh()} iconName="refresh">
              Refresh
            </Button>
          }
        >
          <V2PartHeading part="integrations">Integrations</V2PartHeading>
        </Header>
      }
      items={integrations.items ?? []}
      trackBy={(integration) => integration.IntegrationId ?? ''}
      wrapLines
      columnDefinitions={[
        {
          id: 'id',
          header: 'ID',
          minWidth: '24ch',
          isRowHeader: true,
          cell: (integration) => (
            <CopyValue kind="name" label="integration ID" value={integration.IntegrationId} none="-" />
          ),
        },
        {
          id: 'type',
          header: 'Type',
          cell: (integration) => <ValueText kind="fixed" value={integration.IntegrationType} none="-" />,
        },
        {
          id: 'target',
          header: 'Target',
          minWidth: '28ch',
          cell: (integration) => <CopyValue label="target" value={integration.IntegrationUri} none="-" />,
        },
        {
          id: 'payload-format',
          header: 'Payload format version',
          cell: (integration) => <ValueText kind="fixed" value={integration.PayloadFormatVersion} none="-" />,
        },
        {
          id: 'routes',
          header: 'Routes',
          cell: (integration) => {
            const { keys, complete } = integrationRoutes(integration, routes.items ?? [], routesComplete);
            if (complete && keys.length === 0) return '-';
            return (
              <SpaceBetween size="xxxs">
                {keys.map((key) => (
                  <ValueText key={key} kind="name" value={key} />
                ))}
                {!complete && <Box color="text-body-secondary">Not all routes are read.</Box>}
              </SpaceBetween>
            );
          },
        },
      ]}
      loading={integrations.items === undefined && integrations.loading}
      loadingText="Loading integrations…"
      empty={
        failure ?? (
          <Box variant="strong" textAlign="center">
            No integrations
          </Box>
        )
      }
      footer={
        (integrations.more || (failure !== null && (integrations.items?.length ?? 0) > 0)) && (
          <SpaceBetween size="s">
            {(integrations.items?.length ?? 0) > 0 && failure}
            {integrations.more && (
              <Button loading={integrations.loading} onClick={integrations.loadMore}>
                Load more integrations
              </Button>
            )}
          </SpaceBetween>
        )
      }
    />
  );
}
