import type { GetApiResponse, Stage } from '@aws-sdk/client-apigatewayv2';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useId, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { AppendedPages } from '../queries';
import { stageInvokeAddress } from '../v2-format';
import { useDeployV2Stage } from '../v2-stage-queries';
import { CreateV2StageDialog } from './create-v2-stage-dialog';
import { DeleteV2StageDialog } from './delete-v2-stage-dialog';
import { RequestReadFailure } from './request-read-failure';
import { V2PartHeading } from './v2-details';

interface V2StagesProps {
  api: GetApiResponse;
  stages: AppendedPages<Stage>;
  connection: AreaConnection;
}

export function V2Stages({ api, stages, connection }: V2StagesProps) {
  const isHttp = api.ProtocolType === 'HTTP';
  const apiId = api.ApiId;
  const endpoint = connection.engineOrigin;
  const [selectedName, setSelectedName] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const deployReasonId = useId();
  const flash = usePageFlash();
  const deploy = useDeployV2Stage(apiId, endpoint);
  const selected = stages.items?.find((stage) => stage.StageName && stage.StageName === selectedName);
  const canChange = apiId !== undefined && endpoint !== undefined && !deploy.isPending;
  const deployReason = selected?.AutoDeploy ? 'This stage deploys automatically.' : undefined;
  const canDeploy = canChange && selected?.StageName !== undefined && !deployReason && deploy.available;

  function handleDeploy() {
    const stageName = selected?.StageName;
    if (!canDeploy || stageName === undefined) return;
    deploy.submit(
      stageName,
      () => {
        flash.show([
          {
            type: 'success',
            content: (
              <>
                API deployed to stage <ValueText kind="name" value={stageName} />.
              </>
            ),
          },
        ]);
      },
      (failure) => {
        const item = actionFailureItem(failure, failure.operation, endpoint);
        flash.show([
          failure.kind === 'emulator-did-not-answer' || failure.kind === 'engine-did-not-answer'
            ? {
                ...item,
                content: (
                  <>
                    {failure.operation} got no answer. {item.content}
                  </>
                ),
              }
            : item,
        ]);
      },
    );
  }

  const columns: TableProps.ColumnDefinition<Stage>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '24ch',
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
    <>
      <Table<Stage>
        ariaLabels={{
          tableLabel: 'Stages',
          selectionGroupLabel: 'Stage selection',
          itemSelectionLabel: (_, stage) => `Select stage ${stage.StageName ?? ''}`,
        }}
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => void stages.refresh()} iconName="refresh">
                  Refresh
                </Button>
                <Button disabled={!canChange || !selected?.StageName} onClick={() => setDeleting(selected?.StageName)}>
                  Delete
                </Button>
                {isHttp && (
                  <>
                    <Button
                      disabled={!canDeploy && !deploy.isPending}
                      loading={deploy.isPending}
                      {...(deployReason && { ariaDescribedby: deployReasonId })}
                      onClick={handleDeploy}
                    >
                      Deploy
                    </Button>
                    <Button variant="primary" disabled={!canChange} onClick={() => setCreateOpen(true)}>
                      Create stage
                    </Button>
                  </>
                )}
              </SpaceBetween>
            }
            description={isHttp && deployReason ? <span id={deployReasonId}>{deployReason}</span> : undefined}
          >
            <V2PartHeading part="stages">Stages</V2PartHeading>
          </Header>
        }
        items={stages.items ?? []}
        selectionType="single"
        selectedItems={selected ? [selected] : []}
        onSelectionChange={({ detail }) => setSelectedName(detail.selectedItems[0]?.StageName)}
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
      {isHttp && createOpen && apiId !== undefined && (
        <CreateV2StageDialog apiId={apiId} endpoint={endpoint} onClose={() => setCreateOpen(false)} />
      )}
      {deleting !== undefined && apiId !== undefined && (
        <DeleteV2StageDialog
          apiId={apiId}
          stageName={deleting}
          endpoint={endpoint}
          onDeleted={() => setSelectedName(undefined)}
          onClose={() => setDeleting(undefined)}
        />
      )}
    </>
  );
}
