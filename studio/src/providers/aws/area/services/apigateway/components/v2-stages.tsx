import type { GetApiResponse, Stage } from '@aws-sdk/client-apigatewayv2';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import type { AppendedPages } from '../queries';
import { stageInvokeAddress } from '../v2-format';
import { RequestReadFailure } from './request-read-failure';
import { V2PartHeading } from './v2-details';

interface V2StagesProps {
  api: GetApiResponse;
  stages: AppendedPages<Stage>;
  connection: AreaConnection;
}

export function V2Stages({ api, stages, connection }: V2StagesProps) {
  const isHttp = api.ProtocolType === 'HTTP';
  const columns: TableProps.ColumnDefinition<Stage>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      cell: (stage) => <ValueText kind="name" value={stage.StageName} none="-" />,
    },
    {
      id: 'auto-deploy',
      header: 'Auto-deploy',
      cell: (stage) => (stage.AutoDeploy ? 'On' : 'Off'),
    },
    {
      id: 'deployment',
      header: 'Deployment ID',
      cell: (stage) => <CopyValue kind="name" label="deployment ID" value={stage.DeploymentId} none="-" />,
    },
    {
      id: 'last-change',
      header: 'Last change',
      cell: (stage) => <ValueText kind="fixed" value={creationDateText(stage.LastUpdatedDate)} />,
    },
  ];
  if (isHttp) {
    columns.push({
      id: 'address',
      header: 'Invoke address',
      cell: (stage) => <CopyValue label="invoke address" value={stageInvokeAddress(api, stage)} none="-" />,
    });
  }

  const failure =
    stages.failure === undefined ? null : (
      <RequestReadFailure failure={stages.failure} connection={connection} thing="stages" onRetry={stages.retry} />
    );

  return (
    <Table<Stage>
      ariaLabels={{ tableLabel: 'Stages' }}
      header={
        <Header
          variant="h2"
          actions={
            <Button onClick={() => void stages.refresh()} iconName="refresh">
              Refresh
            </Button>
          }
        >
          <V2PartHeading part="stages">Stages</V2PartHeading>
        </Header>
      }
      items={stages.items ?? []}
      trackBy={(stage) => stage.StageName ?? ''}
      wrapLines
      columnDefinitions={columns}
      loading={stages.items === undefined && stages.loading}
      loadingText="Loading stages…"
      empty={
        failure ?? (
          <Box textAlign="center">
            <SpaceBetween size="xxs">
              <Box variant="strong">No stages</Box>
              {isHttp && <Box>Create a stage to get an invoke URL.</Box>}
            </SpaceBetween>
          </Box>
        )
      }
      footer={
        (stages.more || (failure !== null && (stages.items?.length ?? 0) > 0)) && (
          <SpaceBetween size="s">
            {(stages.items?.length ?? 0) > 0 && failure}
            {stages.more && (
              <Button loading={stages.loading} onClick={stages.loadMore}>
                Load more stages
              </Button>
            )}
          </SpaceBetween>
        )
      }
    />
  );
}
