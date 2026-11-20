import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NotFound } from '../components/not-found';
import type { Revision, RevisionContainer } from '../definition-api';
import { commandText, essentialText, portsText, revisionJson } from '../definition-format';
import { useRevision } from '../definition-queries';
import { familyHref, NONE, registerHref, statusText, TASK_DEFINITIONS_WORD } from '../format';

// A revision, S9 (issue 575, design task 4): one `DescribeTaskDefinition` of `family:revision`, its summary, its
// containers and its JSON as the emulator answered it. A revision the emulator cannot describe is the not-found
// state.

function Summary({ revision }: { revision: Revision }) {
  return (
    <Container header={<Header variant="h2">Task definition details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Task definition details"
        items={[
          { label: 'ARN', value: <CopyValue label="ARN" value={revision.arn} kind="address" none={NONE} /> },
          { label: 'Status', value: <ValueText kind="fixed" value={statusText(revision.status)} /> },
          { label: 'Network mode', value: <ValueText kind="fixed" value={revision.networkMode} none={NONE} /> },
          {
            label: 'Compatibilities',
            value: <ValueText kind="fixed" value={revision.compatibilities.join(', ')} none={NONE} />,
          },
          { label: 'CPU', value: <ValueText kind="fixed" value={revision.cpu} none={NONE} /> },
          { label: 'Memory', value: <ValueText kind="fixed" value={revision.memory} none={NONE} /> },
          {
            label: 'Execution role',
            value: <ValueText kind="address" value={revision.executionRoleArn} none={NONE} />,
          },
          { label: 'Task role', value: <ValueText kind="address" value={revision.taskRoleArn} none={NONE} /> },
          {
            label: 'Registered at',
            value: <ValueText kind="fixed" value={creationDateText(revision.registeredAt)} />,
          },
        ]}
      />
    </Container>
  );
}

const CONTAINER_COLUMNS: TableProps.ColumnDefinition<RevisionContainer>[] = [
  {
    id: 'name',
    header: 'Name',
    isRowHeader: true,
    cell: (container) => <ValueText kind="name" value={container.name} />,
  },
  {
    id: 'image',
    header: 'Image',
    cell: (container) => <ValueText kind="address" value={container.image} none={NONE} />,
  },
  {
    id: 'essential',
    header: 'Essential',
    cell: (container) => <ValueText kind="fixed" value={essentialText(container.essential)} />,
  },
  {
    id: 'command',
    header: 'Command',
    cell: (container) => <ValueText kind="text" value={commandText(container.command)} />,
  },
  { id: 'ports', header: 'Ports', cell: (container) => <ValueText kind="fixed" value={portsText(container.ports)} /> },
  {
    id: 'log-group',
    header: 'Log group',
    cell: (container) => <ValueText kind="address" value={container.logGroup} none={NONE} />,
  },
];

function Containers({ revision }: { revision: Revision }) {
  return (
    <Table<RevisionContainer>
      variant="container"
      items={revision.containers}
      trackBy="name"
      columnDefinitions={CONTAINER_COLUMNS}
      wrapLines
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="strong" color="inherit">
            No containers
          </Box>
        </Box>
      }
      header={<Header variant="h2">Containers</Header>}
    />
  );
}

function Json({ revision }: { revision: Revision }) {
  const json = revisionJson(revision.answer);
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <CopyToClipboard
              variant="button"
              textToCopy={json}
              copyButtonText="Copy JSON"
              copySuccessText="JSON copied"
              copyErrorText="JSON could not be copied"
              popoverRenderWithPortal={false}
            />
          }
        >
          JSON
        </Header>
      }
    >
      <Box variant="code" display="block">
        {/* The JSON's line breaks and indents kept; inside, free text of the area's one way of breaking. */}
        <span style={{ whiteSpace: 'pre-wrap' }}>
          <ValueText kind="text" value={json} />
        </span>
      </Box>
    </Container>
  );
}

/**
 * `/aws/ecs/task-definitions/family/{family}/revision/{revision}`: the revision, read on every opening and refresh. A
 * failed read is read again once the connection is connected again.
 */
export function RevisionPage({ connection, params }: ScreenPageProps) {
  useShowsResources(TASK_DEFINITIONS_WORD);
  const family = params['family'] ?? '';
  const revisionText = params['revision'] ?? '';
  const number = /^\d+$/.test(revisionText) ? Number(revisionText) : Number.NaN;
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const reading = useRevision(connection.engineOrigin, family, number);
  const { value: read, failure, refresh } = reading;
  const revision = read?.found === true ? read.revision : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'task definition');
  const title = `${family}:${revisionText}`;

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = failureState?.firstText;
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
    if (connected && (failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={handleRefresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading task definition</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (revision === undefined) {
    content = (
      <NotFound
        heading={`No revision ${title}`}
        statement="The local emulator has no such task definition."
        link={{ text: family, href: familyHref(family) }}
      />
    );
  } else {
    content = (
      <SpaceBetween size="l">
        <Summary revision={revision} />
        <Containers revision={revision} />
        <Json revision={revision} />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                <Button
                  variant="primary"
                  href={registerHref({ family, revision: revisionText })}
                  onFollow={handleFollow}
                >
                  Register new revision
                </Button>
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={title} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
