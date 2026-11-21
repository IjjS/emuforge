import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Cluster } from '../api';
import { DeleteClusterDialog } from '../components/delete-cluster-dialog';
import { NotFound } from '../components/not-found';
import { ServicesTable } from '../components/services-table';
import { TasksTable } from '../components/tasks-table';
import {
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  NONE,
  RUN_TASK_TITLE,
  runTaskHref,
  SERVICES_AND_TASKS_WORD,
  SERVICES_SECTION_ID,
  statusText,
} from '../format';
import { ECS_KEYS, useCluster } from '../queries';
import { countText } from '../service-format';

// A cluster, S3 (issue 575, R4 and design tasks 1 and 5): its cluster read first, and while that is not found nothing
// else is read or shown; then its summary, its services table and its tasks table. Each table follows itself and
// tells the page of each read following made, and the page reads its summary again with it, so a count of the
// summary and the table under it are of one moment. A change found by following is shown in place, never as a flash;
// "Delete cluster" is the shared dialog, whose success hands the flash over to the clusters list.

function Summary({ cluster }: { cluster: Cluster }) {
  const fixed = (value: string) => <ValueText kind="fixed" value={value} />;
  return (
    <Container header={<Header variant="h2">Cluster details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Cluster details"
        items={[
          { label: 'ARN', value: <CopyValue label="ARN" value={cluster.arn} kind="address" none={NONE} /> },
          { label: 'Status', value: fixed(statusText(cluster.status)) },
          { label: 'Active services', value: fixed(countText(cluster.activeServices)) },
          { label: 'Running tasks', value: fixed(countText(cluster.runningTasks)) },
          { label: 'Pending tasks', value: fixed(countText(cluster.pendingTasks)) },
        ]}
      />
    </Container>
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

function focusServices(target: HTMLElement) {
  const layout = target.closest('main');
  let row = layout?.querySelector<HTMLElement>('nav[aria-label="Breadcrumbs"]') ?? null;
  // AppLayout's scroll padding already clears Studio's bar. The mobile breadcrumb row adds its own height.
  while (row !== null && row !== layout && getComputedStyle(row).position !== 'sticky') {
    row = row.parentElement;
  }
  const margin = target.style.scrollMarginTop;
  if (row !== null && row !== layout) {
    target.style.scrollMarginTop = `calc(${row.getBoundingClientRect().height}px + var(--space-static-xs-b6kz15))`;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  target.style.scrollMarginTop = margin;
}

/** `/aws/ecs/clusters/cluster/{cluster}`. */
export function ClusterPage({ connection, params }: ScreenPageProps) {
  useShowsResources(SERVICES_AND_TASKS_WORD);
  const name = params['cluster'] ?? '';
  const flash = usePageFlash();
  const client = useQueryClient();
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [deleting, setDeleting] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  const clusterRead = useCluster(connection.engineOrigin, name);
  const clusterMissing = clusterRead.value?.found === false;
  const cluster = clusterRead.value?.found === true ? clusterRead.value.cluster : undefined;

  const refreshCluster = clusterRead.refresh;
  const readAgain = useCallback(() => {
    refreshCluster();
    setRefreshKey((current) => current + 1);
  }, [refreshCluster]);

  // A table's read made by following reads the summary again, in place, by s1's root of the cluster's reads.
  const handleFollowedRead = useCallback(() => {
    void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(name) });
  }, [client, name]);

  const clusterFailure =
    clusterRead.failure === undefined ? undefined : readFailureState(clusterRead.failure, connection, 'cluster');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = clusterFailure?.firstText;
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
    if (connected && (clusterFailure !== undefined || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  const handleDeleted = (deleted: string) => {
    setDeleting(undefined);
    flash.handOver(CLUSTERS_PATH, [{ type: 'success', content: `Cluster ${deleted} deleted.` }]);
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
        heading={`No cluster named ${name}`}
        statement="The local emulator has no active cluster of this name."
        link={{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }}
      />
    );
  } else if (cluster === undefined) {
    content = <Loading>Loading cluster</Loading>;
  } else {
    content = (
      <SpaceBetween size="l">
        <Summary cluster={cluster} />
        <ServicesTable
          connection={connection}
          cluster={name}
          onFollowedRead={handleFollowedRead}
          refreshKey={refreshKey}
        />
        <TasksTable
          connection={connection}
          cluster={name}
          runHref={runTaskHref(name)}
          onFollowedRead={handleFollowedRead}
          refreshKey={refreshKey}
        />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={
              cluster !== undefined &&
              clusterFailure === undefined && (
                <Link
                  href={`#${SERVICES_SECTION_ID}`}
                  onFollow={(event) => {
                    const target = document.getElementById(SERVICES_SECTION_ID);
                    if (target !== null) {
                      event.preventDefault();
                      focusServices(target);
                    }
                  }}
                >
                  Jump to Services
                </Link>
              )
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {cluster !== undefined && (
                  <>
                    <Button
                      onClick={() => {
                        setDeleting(cluster.name);
                      }}
                    >
                      Delete cluster
                    </Button>
                    <Button variant="primary" href={runTaskHref(name)} onFollow={handleFollow}>
                      {RUN_TASK_TITLE}
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
      <DeleteClusterDialog
        cluster={deleting}
        connection={connection}
        onDeleted={handleDeleted}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
