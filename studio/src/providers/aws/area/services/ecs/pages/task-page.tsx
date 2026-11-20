import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
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
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NotFound } from '../components/not-found';
import { StopTaskDialog } from '../components/stop-task-dialog';
import { TaskLogs } from '../components/task-logs';
import {
  clusterHref,
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  NONE,
  revisionHref,
  serviceHref,
  SERVICES_AND_TASKS_WORD,
  statusText,
} from '../format';
import { useRevision } from '../definition-queries';
import { useCluster } from '../queries';
import type { Task, TaskContainer } from '../task-api';
import {
  definitionText,
  essentialContainers,
  exitCodeText,
  lastStatusType,
  needsRevision,
  serviceOfGroup,
  stopOutcomeType,
  taskTexts,
} from '../task-format';
import { useTask } from '../task-queries';

// A task, S5 (issue 575, R4 and design tasks 1 to 3): its cluster read first, and while that is not found nothing of
// the task is read or shown; then the task, read again every 3 seconds until it is `STOPPED` (`follow.ts`), its
// containers and a log part per container. A change found by following is shown in place, never as a flash; the
// result of "Stop task" is the area's flash.

const ALREADY_STOPPED = 'The task is already stopped or stopping.';

/** A min width that keeps a container's name, and its image, whole (`studio/AGENTS.md`, aws-area entry 4). */
const NAME_MIN_WIDTH = '28ch';
const IMAGE_MIN_WIDTH = '32ch';

/** The names a screen reader gives the outcome Alert's icon, by its type. */
const OUTCOME_ICON_LABELS = { errorIconAriaLabel: 'Error', infoIconAriaLabel: 'Info' };

/** The name a screen reader gives the Last status icon, by its type. */
const STATUS_ICON_LABELS: Record<StatusIndicatorProps.Type, string> = {
  success: 'Success',
  stopped: 'Stopped',
  pending: 'Pending',
  'in-progress': 'In progress',
  info: 'Info',
  error: 'Error',
  warning: 'Warning',
  loading: 'Loading',
  'not-started': 'Not started',
  log: 'Log',
};

/**
 * How a stopped task ended, above its summary (critique final r1 and r2): the emulator's stop code and stopped
 * reason, and the exit code of each essential container that has one. The stop code decides the Alert's type
 * (`stopOutcomeType`, critique final r3): a stop by "Stop task" or a deployment is info even with SIGTERM's 143.
 */
function Outcome({ task, essential }: { task: Task; essential: TaskContainer[] | undefined }) {
  const texts = taskTexts(task);
  const exited = (essential ?? []).filter((container) => container.exitCode !== undefined);
  return (
    <Alert
      type={stopOutcomeType(task.stopCode, essential)}
      i18nStrings={OUTCOME_ICON_LABELS}
      header={`Task stopped: ${texts.stopCode}`}
    >
      <SpaceBetween size="xxs">
        <ValueText kind="text" value={texts.stoppedReason} />
        {exited.map((container) => (
          <span key={container.name}>
            Exit code of essential container <ValueText kind="name" value={container.name} />:{' '}
            <ValueText kind="fixed" value={exitCodeText(container.exitCode)} />
          </span>
        ))}
      </SpaceBetween>
    </Alert>
  );
}

function Summary({ cluster, task }: { cluster: string; task: Task }) {
  const handleFollow = useFollow();
  const texts = taskTexts(task);
  const service = serviceOfGroup(task.group);
  const fixed = (value: string) => <ValueText kind="fixed" value={value} />;
  return (
    <Container header={<Header variant="h2">Task details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Task details"
        items={[
          { label: 'ARN', value: <CopyValue label="ARN" value={task.arn} kind="address" none={NONE} /> },
          {
            label: 'Last status',
            value: (
              <StatusIndicator
                type={lastStatusType(task.lastStatus)}
                iconAriaLabel={STATUS_ICON_LABELS[lastStatusType(task.lastStatus)]}
              >
                {statusText(task.lastStatus)}
              </StatusIndicator>
            ),
          },
          { label: 'Desired status', value: fixed(statusText(task.desiredStatus)) },
          {
            label: 'Task definition',
            value:
              task.definition === undefined ? (
                <ValueText kind="address" value={texts.definition} />
              ) : (
                <Link href={revisionHref(task.definition.family, task.definition.revision)} onFollow={handleFollow}>
                  <ValueText kind="name" value={definitionText(task.definition)} />
                </Link>
              ),
          },
          {
            label: 'Group',
            value:
              service === undefined ? (
                <ValueText kind="name" value={texts.group} />
              ) : (
                <Link href={serviceHref(cluster, service)} onFollow={handleFollow}>
                  <ValueText kind="name" value={texts.group} />
                </Link>
              ),
          },
          { label: 'Launch type', value: fixed(texts.launchType) },
          { label: 'Started by', value: <ValueText kind="name" value={texts.startedBy} /> },
          { label: 'CPU', value: fixed(texts.cpu) },
          { label: 'Memory', value: fixed(texts.memory) },
          { label: 'Created at', value: fixed(texts.createdAt) },
          { label: 'Started at', value: fixed(texts.startedAt) },
          { label: 'Stopped at', value: fixed(texts.stoppedAt) },
          { label: 'Stop code', value: fixed(texts.stopCode) },
          { label: 'Stopped reason', value: <ValueText kind="text" value={texts.stoppedReason} /> },
          {
            label: 'Private IP',
            value: <CopyValue label="Private IP" value={task.privateIp} kind="name" none={NONE} />,
          },
          { label: 'Subnet', value: <CopyValue label="Subnet" value={task.subnet} kind="name" none={NONE} /> },
          {
            label: 'Network interface',
            value: <CopyValue label="Network interface" value={task.networkInterface} kind="name" none={NONE} />,
          },
        ]}
      />
    </Container>
  );
}

function Containers({ containers }: { containers: TaskContainer[] }) {
  const columns: TableProps.ColumnDefinition<TaskContainer>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (container) => <ValueText kind="name" value={container.name} />,
    },
    {
      id: 'image',
      header: 'Image',
      minWidth: IMAGE_MIN_WIDTH,
      cell: (container) => <ValueText kind="address" value={container.image} none={NONE} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (container) => <ValueText kind="fixed" value={statusText(container.status)} />,
    },
    {
      id: 'exit-code',
      header: 'Exit code',
      cell: (container) => <ValueText kind="fixed" value={exitCodeText(container.exitCode)} />,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (container) => <ValueText kind="text" value={container.reason} none={NONE} />,
    },
  ];
  return (
    <Table<TaskContainer>
      variant="container"
      header={<Header variant="h2">Containers</Header>}
      items={containers}
      trackBy="name"
      columnDefinitions={columns}
      wrapLines
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="strong" color="inherit">
            No containers
          </Box>
        </Box>
      }
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

/** The flash of a refused stop: the emulator's code and message, or the area's item of any other failure. */
function stopFailureItem(task: string, failure: RequestFailure, engineOrigin: string | undefined): FlashItem {
  return failure.kind === 'other'
    ? {
        type: 'error',
        header: `The emulator did not stop task ${task}.`,
        content: <CodeAndMessage code={failure.code} message={failure.message} />,
      }
    : actionFailureItem(failure, `Stopping task ${task}`, engineOrigin);
}

/** `/aws/ecs/clusters/cluster/{cluster}/tasks/task/{task}`. */
export function TaskPage({ connection, params }: ScreenPageProps) {
  useShowsResources(SERVICES_AND_TASKS_WORD);
  const clusterName = params['cluster'] ?? '';
  const id = params['task'] ?? '';
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [stopping, setStopping] = useState<string>();

  const clusterRead = useCluster(connection.engineOrigin, clusterName);
  const clusterMissing = clusterRead.value?.found === false;
  // Once the cluster is found the task is read; a later read of the cluster does not take it away.
  const [clusterFound, setClusterFound] = useState(false);
  if (clusterRead.value?.found === true && !clusterFound) {
    setClusterFound(true);
  }
  const taskRead = useTask(connection.engineOrigin, clusterName, id, clusterFound && !clusterMissing);
  const task = taskRead.value?.found === true ? taskRead.value.task : undefined;
  // The revision is read only for what a stopped task of several containers needs: which of them are essential.
  // Revision 0 is no revision's, and `useRevision` reads nothing for it.
  const revisionNeeded = task !== undefined && needsRevision(task);
  const revisionRead = useRevision(
    connection.engineOrigin,
    revisionNeeded ? (task.definition?.family ?? '') : '',
    revisionNeeded ? (task.definition?.revision ?? 0) : 0,
  );
  const revisionContainers =
    revisionNeeded && revisionRead.value?.found === true ? revisionRead.value.revision.containers : undefined;

  const refreshCluster = clusterRead.refresh;
  const refreshTask = taskRead.refresh;
  const refreshRevision = revisionRead.refresh;
  const readAgain = useCallback(() => {
    refreshCluster();
    refreshTask();
    refreshRevision();
  }, [refreshCluster, refreshTask, refreshRevision]);

  const clusterFailure =
    clusterRead.failure === undefined ? undefined : readFailureState(clusterRead.failure, connection, 'cluster');
  const taskFailure =
    taskRead.failure === undefined ? undefined : readFailureState(taskRead.failure, connection, 'task');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = (clusterFailure ?? taskFailure)?.firstText;
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
    if (connected && (clusterFailure !== undefined || taskFailure !== undefined || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  const handleStopped = (stopped: string) => {
    setStopping(undefined);
    flash.show([{ type: 'success', content: `Stopping task ${stopped}.` }]);
  };
  const handleStopFailed = (stopped: string, failure: RequestFailure) => {
    setStopping(undefined);
    flash.show([stopFailureItem(stopped, failure, connection.engineOrigin)]);
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
  } else if (taskFailure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={taskFailure} onRetry={readAgain} />
      </Container>
    );
  } else if (taskRead.value === undefined) {
    content = <Loading>Loading task</Loading>;
  } else if (task === undefined) {
    content = (
      <NotFound
        heading={`No task ${id}`}
        statement={`Cluster ${clusterName} of the local emulator has no task of this ID.`}
        link={{ text: clusterName, href: clusterHref(clusterName) }}
      />
    );
  } else {
    content = (
      <SpaceBetween size="l">
        {task.lastStatus === 'STOPPED' && (
          <Outcome task={task} essential={essentialContainers(task, revisionContainers)} />
        )}
        <Summary cluster={clusterName} task={task} />
        <Containers containers={task.containers} />
        <TaskLogs connection={connection} cluster={clusterName} task={task} />
      </SpaceBetween>
    );
  }

  const stopped = task?.desiredStatus === 'STOPPED';

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {task !== undefined && (
                  <Button
                    disabled={stopped}
                    {...(stopped ? { disabledReason: ALREADY_STOPPED } : {})}
                    onClick={() => {
                      if (!stopped) {
                        setStopping(task.id);
                      }
                    }}
                  >
                    Stop task
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={`Task ${id}`} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <StopTaskDialog
        task={stopping}
        cluster={clusterName}
        connection={connection}
        onStopped={handleStopped}
        onFailed={handleStopFailed}
        onDismiss={() => {
          setStopping(undefined);
        }}
      />
      {announcement}
    </>
  );
}
