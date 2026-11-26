import type { Stage } from '@aws-sdk/client-api-gateway';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import { GET_STAGE_ADDRESS } from '../rest-api';
import { refreshRestStages, useRestStages, useStageAddress } from '../rest-queries';
import { useShowPart } from '../show-part';
import { DeleteRestStageDialog } from './delete-rest-stage-dialog';
import { DeployDialog } from './deploy-dialog';
import { RequestReadFailure, requestReadFailureState } from './request-read-failure';

function StageAddress({
  apiId,
  stageName,
  connection,
}: {
  apiId: string;
  stageName: string;
  connection: AreaConnection;
}) {
  const { data, failure, loading } = useStageAddress(apiId, stageName, connection.engineOrigin);
  if (failure) {
    const { first, type } = requestReadFailureState(failure, connection, 'invoke URL');
    return (
      <SpaceBetween size="xxxs">
        <Box variant="strong">{GET_STAGE_ADDRESS}</Box>
        <StatusIndicator type={type}>{first}</StatusIndicator>
        {(failure.kind === 'access-denied' || failure.kind === 'other') && (
          <ValueText kind="text" value={failure.message ?? (failure.kind === 'other' ? failure.code : '')} />
        )}
      </SpaceBetween>
    );
  }
  if (data === undefined && loading) return <StatusIndicator type="loading">Loading invoke URL…</StatusIndicator>;
  return <CopyValue label="Invoke URL" value={data} none="-" />;
}

export function RestStages({ apiId, connection }: { apiId: string; connection: AreaConnection }) {
  const client = useQueryClient();
  const { data, failure, loading } = useRestStages(apiId, connection.engineOrigin);
  const [selectedName, setSelectedName] = useState<string>();
  const [deployOpen, setDeployOpen] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const selected = data?.find((stage) => stage.stageName && stage.stageName === selectedName);
  const focusHeading = useShowPart('stages');
  const refresh = () => void refreshRestStages(client, apiId);

  return (
    <SpaceBetween size="s">
      <Table<Stage>
        ariaLabels={{
          tableLabel: 'Stages',
          selectionGroupLabel: 'Stage selection',
          itemSelectionLabel: (_, stage) => `Select stage ${stage.stageName ?? ''}`,
        }}
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={refresh}>
                  Refresh
                </Button>
                <Button disabled={!selected?.stageName} onClick={() => setDeleting(selected?.stageName)}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setDeployOpen(true)}>
                  Deploy API
                </Button>
              </SpaceBetween>
            }
            description="A stage serves the API as it was when last deployed. Deploy again after you change resources or methods."
          >
            <span
              ref={(text) => {
                const heading = text?.closest('h2') ?? null;
                if (heading) heading.tabIndex = -1;
                focusHeading(heading);
              }}
            >
              Stages
            </span>
          </Header>
        }
        items={data ?? []}
        selectionType="single"
        selectedItems={selected ? [selected] : []}
        onSelectionChange={({ detail }) => setSelectedName(detail.selectedItems[0]?.stageName)}
        trackBy={(stage) => stage.stageName ?? ''}
        wrapLines
        loading={data === undefined && loading}
        loadingText="Loading stages…"
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            isRowHeader: true,
            minWidth: '24ch',
            cell: (stage) => <ValueText kind="name" value={stage.stageName} none="-" />,
          },
          {
            id: 'deployment',
            header: 'Deployment ID',
            cell: (stage) => <CopyValue label="Deployment ID" value={stage.deploymentId} kind="name" none="-" />,
          },
          {
            id: 'changed',
            header: 'Last change',
            cell: (stage) => <ValueText kind="fixed" value={creationDateText(stage.lastUpdatedDate)} />,
          },
          {
            id: 'address',
            header: 'Invoke URL',
            cell: (stage) =>
              stage.stageName ? (
                <StageAddress apiId={apiId} stageName={stage.stageName} connection={connection} />
              ) : (
                '-'
              ),
          },
        ]}
        empty={
          failure ? (
            <RequestReadFailure failure={failure} connection={connection} thing="stages" onRetry={refresh} />
          ) : (
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <Box variant="strong">No stages</Box>
                <Box>Deploy the API to a stage to get an invoke URL.</Box>
              </SpaceBetween>
            </Box>
          )
        }
      />
      {failure && data && data.length > 0 && (
        <RequestReadFailure failure={failure} connection={connection} thing="stages" onRetry={refresh} />
      )}
      {deployOpen && (
        <DeployDialog
          apiId={apiId}
          connection={connection}
          hasStages={data?.some((stage) => Boolean(stage.stageName)) ?? false}
          onClose={() => setDeployOpen(false)}
        />
      )}
      {deleting !== undefined && (
        <DeleteRestStageDialog
          apiId={apiId}
          connection={connection}
          stageName={deleting}
          onClose={() => setDeleting(undefined)}
        />
      )}
    </SpaceBetween>
  );
}
