import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { CopyValue } from '../../../components/copy-value';
import {
  actionFailureItem,
  CodeAndMessage,
  readFailureState,
  ReadFailure,
  useAnnouncer,
} from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { DeleteServiceDialog } from '../components/delete-service-dialog';
import { NotFound } from '../components/not-found';
import { TasksTable } from '../components/tasks-table';
import { UpdateServiceDialog } from '../components/update-service-dialog';
import {
  clusterHref,
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  NONE,
  revisionHref,
  SERVICES_AND_TASKS_WORD,
  statusText,
} from '../format';
import { useCluster } from '../queries';
import type { Service, ServiceDeployment, ServiceEvent } from '../service-api';
import { countText, networkTexts } from '../service-format';
import { serviceKey, useService } from '../service-queries';
import { definitionText, type Definition } from '../task-format';

// A service, S4 (issue 575, R4 and design tasks 1 and 6): its cluster read first, and while that is not found nothing
// else is read or shown; then the service, whatever its status, with its summary, deployments, events and tasks. The
// service is read again by its own following rule and with each read its tasks table makes by following, so a count
// of the summary and the table are of one moment; a change found so is shown in place, never as a flash. Both
// dialogs stay mounted whatever the reads answer, and their results are the area's flash.

const NOT_ACTIVE = 'The service is not active.';

function DefinitionLink({ definition, arn }: { definition: Definition | undefined; arn: string | undefined }) {
  const handleFollow = useFollow();
  if (definition === undefined) {
    return <ValueText kind="address" value={arn} none={NONE} />;
  }
  return (
    <Link href={revisionHref(definition.family, definition.revision)} onFollow={handleFollow}>
      <ValueText kind="name" value={definitionText(definition)} />
    </Link>
  );
}

function Summary({ service }: { service: Service }) {
  const fixed = (value: string) => <ValueText kind="fixed" value={value} />;
  const network = networkTexts(service);
  return (
    <Container header={<Header variant="h2">Service details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Service details"
        items={[
          { label: 'ARN', value: <CopyValue label="ARN" value={service.arn} kind="address" none={NONE} /> },
          { label: 'Status', value: fixed(statusText(service.status)) },
          { label: 'Desired tasks', value: fixed(countText(service.desired)) },
          { label: 'Running tasks', value: fixed(countText(service.running)) },
          { label: 'Pending tasks', value: fixed(countText(service.pending)) },
          {
            label: 'Task definition',
            value: <DefinitionLink definition={service.definition} arn={service.definitionArn} />,
          },
          { label: 'Launch type', value: <ValueText kind="fixed" value={service.launchType} none={NONE} /> },
          { label: 'Created at', value: fixed(creationDateText(service.createdAt)) },
          { label: 'Subnets', value: <ValueText kind="name" value={network.subnets} /> },
          { label: 'Security groups', value: <ValueText kind="name" value={network.securityGroups} /> },
          { label: 'Public IP', value: fixed(network.publicIp) },
        ]}
      />
    </Container>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Box textAlign="center" color="inherit">
      <Box variant="strong" color="inherit">
        {children}
      </Box>
    </Box>
  );
}

/** The narrowest a deployment's ID column is: its id on one line. */
const ID_MIN_WIDTH = '28ch';

function Deployments({ deployments }: { deployments: ServiceDeployment[] }) {
  const fixed = (value: string) => <ValueText kind="fixed" value={value} />;
  const columns: TableProps.ColumnDefinition<ServiceDeployment>[] = [
    {
      id: 'id',
      header: 'ID',
      isRowHeader: true,
      // A deployment's id (`ecs-svc/` and 19 digits) is held on one line, as the other name columns are.
      minWidth: ID_MIN_WIDTH,
      cell: (deployment) => <ValueText kind="name" value={deployment.id} />,
    },
    { id: 'status', header: 'Status', cell: (deployment) => fixed(statusText(deployment.status)) },
    { id: 'rollout', header: 'Rollout', cell: (deployment) => fixed(statusText(deployment.rolloutState)) },
    {
      id: 'definition',
      header: 'Task definition',
      cell: (deployment) => <DefinitionLink definition={deployment.definition} arn={deployment.definitionArn} />,
    },
    { id: 'desired', header: 'Desired', cell: (deployment) => fixed(countText(deployment.desired)) },
    { id: 'running', header: 'Running', cell: (deployment) => fixed(countText(deployment.running)) },
    { id: 'pending', header: 'Pending', cell: (deployment) => fixed(countText(deployment.pending)) },
    { id: 'failed', header: 'Failed tasks', cell: (deployment) => fixed(countText(deployment.failed)) },
    { id: 'updated', header: 'Updated at', cell: (deployment) => fixed(creationDateText(deployment.updatedAt)) },
  ];
  return (
    <Table<ServiceDeployment>
      variant="container"
      header={
        <Header variant="h2" counter={`(${String(deployments.length)})`}>
          Deployments
        </Header>
      }
      items={deployments}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      empty={<Empty>No deployments</Empty>}
    />
  );
}

function Events({ events }: { events: ServiceEvent[] }) {
  const columns: TableProps.ColumnDefinition<ServiceEvent>[] = [
    {
      id: 'time',
      header: 'Time',
      cell: (event) => <ValueText kind="fixed" value={creationDateText(event.createdAt)} />,
    },
    {
      id: 'message',
      header: 'Message',
      isRowHeader: true,
      cell: (event) => <ValueText kind="text" value={event.message} none={NONE} />,
    },
  ];
  return (
    <Table<ServiceEvent>
      variant="container"
      header={
        <Header variant="h2" counter={`(${String(events.length)})`}>
          Events
        </Header>
      }
      items={events}
      columnDefinitions={columns}
      wrapLines
      empty={<Empty>No events yet</Empty>}
    />
  );
}

function Loading({ children }: { children: string }) {
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <StatusIndicator type="loading">{children}</StatusIndicator>
      </Box>
    </Container>
  );
}

/** The flash of a refused delete: the emulator's code and message, or the area's item of any other failure. */
function deleteFailureItem(name: string, failure: RequestFailure, engineOrigin: string | undefined): FlashItem {
  return failure.kind === 'other'
    ? {
        type: 'error',
        header: `The emulator did not delete service ${name}.`,
        content: <CodeAndMessage code={failure.code} message={failure.message} />,
      }
    : actionFailureItem(failure, `Deleting service ${name}`, engineOrigin);
}

/** `/aws/ecs/clusters/cluster/{cluster}/services/service/{service}`. */
export function ServicePage({ connection, params }: ScreenPageProps) {
  useShowsResources(SERVICES_AND_TASKS_WORD);
  const clusterName = params['cluster'] ?? '';
  const name = params['service'] ?? '';
  const flash = usePageFlash();
  const client = useQueryClient();
  const [announcement, announce] = useAnnouncer();
  const [updating, setUpdating] = useState<Service>();
  const [deleting, setDeleting] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  const clusterRead = useCluster(connection.engineOrigin, clusterName);
  const clusterMissing = clusterRead.value?.found === false;
  // Once the cluster is found the service is read; a later read of the cluster does not take it away.
  const [clusterFound, setClusterFound] = useState(false);
  if (clusterRead.value?.found === true && !clusterFound) {
    setClusterFound(true);
  }
  const serviceRead = useService(connection.engineOrigin, clusterName, name, clusterFound && !clusterMissing);
  const service = serviceRead.value?.found === true ? serviceRead.value.service : undefined;

  const refreshCluster = clusterRead.refresh;
  const refreshService = serviceRead.refresh;
  const readAgain = useCallback(() => {
    refreshCluster();
    refreshService();
    setRefreshKey((current) => current + 1);
  }, [refreshCluster, refreshService]);

  // A read of the tasks table made by following reads the service again, in place.
  const handleFollowedRead = useCallback(() => {
    void client.invalidateQueries({ queryKey: serviceKey(clusterName, name) });
  }, [client, clusterName, name]);

  const clusterFailure =
    clusterRead.failure === undefined ? undefined : readFailureState(clusterRead.failure, connection, 'cluster');
  const serviceFailure =
    serviceRead.failure === undefined ? undefined : readFailureState(serviceRead.failure, connection, 'service');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = (clusterFailure ?? serviceFailure)?.firstText;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (clusterFailure !== undefined || serviceFailure !== undefined || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  const handleUpdated = (updated: string) => {
    setUpdating(undefined);
    flash.show([{ type: 'success', content: `Service ${updated} updated.` }]);
  };
  const handleDeleted = (deleted: string) => {
    setDeleting(undefined);
    flash.handOver(clusterHref(clusterName), [{ type: 'success', content: `Service ${deleted} deleted.` }]);
  };
  const handleDeleteFailed = (deleted: string, failure: RequestFailure) => {
    setDeleting(undefined);
    flash.show([deleteFailureItem(deleted, failure, connection.engineOrigin)]);
  };

  let content;
  if (clusterFailure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={clusterFailure} onRetry={readAgain} />
      </Container>
    );
  } else if (clusterMissing) {
    content = (
      <NotFound
        heading={`No cluster named ${clusterName}`}
        statement="The local emulator has no active cluster of this name."
        link={{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }}
      />
    );
  } else if (serviceFailure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={serviceFailure} onRetry={readAgain} />
      </Container>
    );
  } else if (serviceRead.value === undefined) {
    content = <Loading>Loading service</Loading>;
  } else if (service === undefined) {
    content = (
      <NotFound
        heading={`No service named ${name}`}
        statement={`Cluster ${clusterName} of the local emulator has no service of this name.`}
        link={{ text: clusterName, href: clusterHref(clusterName) }}
      />
    );
  } else {
    content = (
      <SpaceBetween size="l">
        <Summary service={service} />
        <Deployments deployments={service.deployments} />
        <Events events={service.events} />
        <TasksTable
          connection={connection}
          cluster={clusterName}
          service={name}
          onFollowedRead={handleFollowedRead}
          refreshKey={refreshKey}
        />
      </SpaceBetween>
    );
  }

  const active = service?.status === 'ACTIVE';
  const unavailable = active ? {} : { disabled: true, disabledReason: NOT_ACTIVE };

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {service !== undefined && (
                  <>
                    <Button
                      {...unavailable}
                      onClick={() => {
                        if (active) {
                          setDeleting(service.name);
                        }
                      }}
                    >
                      Delete service
                    </Button>
                    <Button
                      variant="primary"
                      {...unavailable}
                      onClick={() => {
                        if (active) {
                          setUpdating(service);
                        }
                      }}
                    >
                      Update service
                    </Button>
                  </>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={name} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <UpdateServiceDialog
        service={updating}
        cluster={clusterName}
        connection={connection}
        onUpdated={handleUpdated}
        onDismiss={() => {
          setUpdating(undefined);
        }}
      />
      <DeleteServiceDialog
        service={deleting}
        cluster={clusterName}
        connection={connection}
        onDeleted={handleDeleted}
        onFailed={handleDeleteFailed}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
